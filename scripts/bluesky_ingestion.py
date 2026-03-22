import os
import asyncio
import logging
import json
import re
import hashlib
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional

import aiohttp
import numpy as np
import backoff
from bs4 import BeautifulSoup
from zoneinfo import ZoneInfo
from cachetools import TTLCache
from dotenv import load_dotenv
from openai import AsyncOpenAI, RateLimitError, APITimeoutError
from atproto import AsyncFirehoseSubscribeReposClient, parse_subscribe_repos_message, models, CAR
from psycopg_pool import AsyncConnectionPool

load_dotenv()

# --- CONFIGURATION ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

ARAMCO_KEYWORDS = ["aramco", "samref", "yanbu", "ras tanura", "oil facility"]
REGEX_PATTERN = re.compile(rf"\b({'|'.join(re.escape(w) for w in ARAMCO_KEYWORDS)})\b", re.IGNORECASE)
TRUSTED_DIDS = {"did:plc:vovinwhtulbsx4mwfw26r5ni", "did:plc:jz3umb574v5ixivurtelqstt", "did:plc:tshrll7hb5scyeg4m6nitxtr"}
MIN_ACCOUNT_AGE_DAYS = 30
IMPACT_SCORE_THRESHOLD = 50
MAX_WORKERS = 5
MAX_QUEUE_SIZE = 50
OPENAI_CONCURRENCY_LIMIT = 3
MAX_RETRIES = 3

# Timezone setup
DEFAULT_TZ_STR = os.getenv("TIMEZONE", "Asia/Singapore")
try:
    APP_TZ = ZoneInfo(DEFAULT_TZ_STR)
except Exception:
    logger.warning(f"Invalid timezone {DEFAULT_TZ_STR}, defaulting to Asia/Singapore")
    APP_TZ = ZoneInfo("Asia/Singapore")

CONTEXT_FILE = Path("docs/saudi_aramco_context.json")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None
openai_semaphore = asyncio.Semaphore(OPENAI_CONCURRENCY_LIMIT)

profile_cache = TTLCache(maxsize=10000, ttl=3600)

# --- UTILS ---

def clean_json_response(raw_text: str) -> str:
    """Removes markdown code blocks (backticks) from LLM response strings."""
    clean = re.sub(r"```json\s*", "", raw_text)
    clean = re.sub(r"```\s*", "", clean)
    return clean.strip()

# --- DATABASE SETUP ---

def get_db_conn_str() -> str:
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "postgres")
    host = os.getenv("POSTGRES_HOST", "db")
    port = os.getenv("POSTGRES_PORT", "5432")
    db_name = os.getenv("POSTGRES_DB", "bsis")
    return f"postgresql://{user}:{password}@{host}:{port}/{db_name}"

async def initialize_database(pool: AsyncConnectionPool):
    """Ensure database schema exists."""
    try:
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                await cur.execute("""
                    CREATE TABLE IF NOT EXISTS intelligence_events (
                        id TEXT PRIMARY KEY,
                        post_uri TEXT,
                        post_text TEXT,
                        uri TEXT,
                        external_title TEXT,
                        external_description TEXT,
                        post_created_at TIMESTAMP WITH TIME ZONE,
                        actionable_insights TEXT,
                        impact_score INTEGER,
                        full_llm_input TEXT,
                        llm_response TEXT,
                        retrieved_context TEXT,
                        ingested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                    );
                """)
                await conn.commit()
                logger.info("Database schema initialized.")
    except Exception as e:
        logger.critical(f"FATAL: Failed to initialize database schema: {e}")
        raise

# --- VECTORIZATION & CONTEXT ---

CONTEXT_CHUNKS = []
CONTEXT_VECTORS = None

@backoff.on_exception(backoff.expo, (APITimeoutError, RateLimitError), max_tries=MAX_RETRIES)
async def get_embeddings(texts: List[str]):
    if not openai_client:
        raise ValueError("OpenAI client not initialized (missing API key).")
    async with openai_semaphore:
        return await openai_client.embeddings.create(
            input=texts,
            model="text-embedding-3-large",
            timeout=15.0
        )

async def load_and_vectorize_context():
    global CONTEXT_CHUNKS, CONTEXT_VECTORS
    if not CONTEXT_FILE.exists():
        logger.error(f"REQUIRED FILE MISSING: Context file not found at {CONTEXT_FILE}")
        raise FileNotFoundError(f"Context file {CONTEXT_FILE} is required for RAG.")

    try:
        with open(CONTEXT_FILE, 'r') as f:
            CONTEXT_CHUNKS = json.load(f)

        if not openai_client:
            logger.warning("OPENAI_API_KEY not found. Skipping context vectorization. RAG will be disabled.")
            return

        texts = [chunk['text'] for chunk in CONTEXT_CHUNKS]
        logger.info(f"Vectorizing {len(texts)} context chunks...")
        
        response = await get_embeddings(texts)
        CONTEXT_VECTORS = np.array([data.embedding for data in response.data])
        logger.info("Context vectorization complete.")
    except Exception as e:
        logger.error(f"Failed context vectorization: {e}")
        raise

async def retrieve_context(post_text: str, top_k: int = 2) -> str:
    if CONTEXT_VECTORS is None or not openai_client:
        return ""

    try:
        response = await get_embeddings([post_text])
        post_vector = np.array(response.data[0].embedding)
        
        norm1 = np.linalg.norm(post_vector)
        norm2 = np.linalg.norm(CONTEXT_VECTORS, axis=1)
        similarities = np.dot(CONTEXT_VECTORS, post_vector) / (norm1 * norm2)
        
        top_indices = np.argsort(similarities)[-top_k:][::-1]
        retrieved = [CONTEXT_CHUNKS[i]['text'] for i in top_indices]
        return "\n\n".join(retrieved)
    except Exception as e:
        logger.error(f"Failed to retrieve context vectors: {e}")
        return ""

# --- WEB SCRAPING ---

def _sync_parse_html(html: str) -> str:
    soup = BeautifulSoup(html, 'html.parser')
    for script in soup(["script", "style"]):
        script.decompose()
    text = soup.get_text()
    lines = (line.strip() for line in text.splitlines())
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    return "\n".join(chunk for chunk in chunks if chunk)[:2000]

async def sanitize_webscrape(url: str, session: aiohttp.ClientSession) -> str:
    if not url:
        return ""
    try:
        async with session.get(url, timeout=10) as response:
            if response.status == 200:
                html = await response.text()
                return await asyncio.to_thread(_sync_parse_html, html)
            else:
                logger.warning(f"Webscrape failed for {url}: HTTP {response.status}")
    except Exception as e:
        logger.warning(f"Webscrape error for {url}: {e}")
    return ""

# --- LLM ANALYSIS ---

@backoff.on_exception(backoff.expo, (APITimeoutError, RateLimitError), max_tries=MAX_RETRIES)
async def call_llm(prompt: str):
    if not openai_client:
        raise ValueError("OpenAI client not initialized (missing API key).")
    async with openai_semaphore:
        return await openai_client.chat.completions.create(
            model="gpt-5.4-nano-2026-03-17",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            timeout=30.0
        )

async def analyze_post(post_data: Dict[str, Any], scraped_content: str, context: str) -> Dict[str, Any]:
    if not openai_client:
        return None

    prompt = f"""SYSTEM: You are a geopolitical intelligence analyst for a global energy firm.
Your task is to analyze a Bluesky post and provide actionable insights regarding the Iran conflict and its impact on Saudi Aramco's supply chain. Your answer should only be influenced by the bluesky post rather than the context of the documents. The documents are only there to provide context if it helps to better understand the bluesky post.
TIMEZONE: {DEFAULT_TZ_STR}

CONTEXT DOCUMENTS:
{context}
-------------------------------------------
WEBSITE CONTENT:
{scraped_content}
-------------------------------------------
BLUESKY POST:
Text: {post_data['text'], 'N/A'}
Title: {post_data.get('title', 'N/A')}
Description: {post_data.get('description', 'N/A')}
-------------------------------------------
Provide JSON with: impact_score (0-100), actionable_insights, reasoning.
"""

    try:
        response = await call_llm(prompt)
        raw_content = response.choices[0].message.content
        clean_content = clean_json_response(raw_content)
        result = json.loads(clean_content)
        
        return {
            "insights": result.get("actionable_insights", ""),
            "score": result.get("impact_score", 0),
            "full_input": prompt,
            "raw_response": raw_content
        }
    except Exception as e:
        logger.error(f"LLM analysis failed: {e}")
    return None

# --- PROFILE CACHE & FILTERS ---

async def get_cached_profile(session: aiohttp.ClientSession, did: str) -> Optional[Dict[str, Any]]:
    if did in profile_cache:
        return profile_cache[did]
    
    url = f"https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor={did}"
    try:
        async with session.get(url, timeout=5) as response:
            if response.status == 200:
                data = await response.json()
                profile_cache[did] = data
                return data
            else:
                logger.warning(f"Profile fetch failed for {did}: HTTP {response.status}")
    except Exception as e:
        logger.warning(f"Profile fetch error for {did}: {e}")
    return None

async def passes_secondary_filters(author_did: str, session: aiohttp.ClientSession) -> bool:
    profile = await get_cached_profile(session, author_did)
    if not profile:
        return False
        
    created_at_str = profile.get("createdAt")
    if not created_at_str:
        return False
        
    try:
        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False

    age = datetime.now(timezone.utc) - created_at
    
    if author_did in TRUSTED_DIDS:
        return True
        
    if age < timedelta(days=MIN_ACCOUNT_AGE_DAYS):
        logger.info(f"Filter Reject: Account {author_did} age {age.days} days < {MIN_ACCOUNT_AGE_DAYS}")
        return False
    
    return True

# --- WORKER PATTERN ---

async def worker(queue: asyncio.Queue, session: aiohttp.ClientSession, pool: AsyncConnectionPool):
    logger.info("Worker started.")
    while True:
        task_data = await queue.get()
        try:
            record = task_data['record']
            author_did = task_data['author_did']
            post_uri = task_data['post_uri']
            
            text = record.get('text', '')
            embed = record.get('embed', {})
            external = embed.get('external', {}) if embed.get('$type') == 'app.bsky.embed.external' else {}
            url = external.get('uri')

            # --- EVENT-CENTRIC DETERMINISTIC ID ---
            # If there's an external URL, that's our unique 'Event'.
            # Otherwise, use the post text.
            dedupe_source = url if url else text
            event_id = hashlib.sha256(dedupe_source.encode('utf-8')).hexdigest()
            
            # 0. PERSISTENT DEDUPLICATION (Saves API Costs)
            async with pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("SELECT 1 FROM intelligence_events WHERE id = %s", (event_id,))
                    if await cur.fetchone():
                        continue
            
            if not await passes_secondary_filters(author_did, session):
                continue

            scraped_content = await sanitize_webscrape(url, session) if url else ""
            context = await retrieve_context(text)

            analysis = await analyze_post({
                "text": text,
                "title": external.get('title'),
                "description": external.get('description')
            }, scraped_content, context)

            if not analysis or analysis['score'] < IMPACT_SCORE_THRESHOLD:
                continue

            async with pool.connection() as conn:
                async with conn.cursor() as cur:
                    await cur.execute("""
                        INSERT INTO intelligence_events (
                            id, post_uri, post_text, uri, external_title, external_description, 
                            post_created_at, actionable_insights, impact_score, 
                            full_llm_input, llm_response, retrieved_context
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                    """, (
                        event_id, post_uri, text, url, external.get('title'), external.get('description'),
                        record.get('createdAt'), analysis['insights'], analysis['score'],
                        analysis['full_input'], analysis['raw_response'], context
                    ))
                    await conn.commit()
            logger.info(f"SUCCESS: Saved unique event {event_id} (Score: {analysis['score']})")

        except Exception as e:
            logger.error(f"Worker unexpected error: {e}")
        finally:
            queue.task_done()

# --- FIREHOSE HANDLERS ---

async def on_message_handler(message, queue: asyncio.Queue):
    try:
        commit = parse_subscribe_repos_message(message)
        if not isinstance(commit, models.ComAtprotoSyncSubscribeRepos.Commit):
            return

        car = CAR.from_bytes(commit.blocks)
        for op in commit.ops:
            if op.action != "create" or not op.path.startswith("app.bsky.feed.post"):
                continue

            record = car.blocks.get(op.cid)
            if not record or not record.get('text'):
                continue

            if REGEX_PATTERN.search(record['text']):
                try:
                    post_uri = f"at://{commit.repo}/{op.path}"
                    queue.put_nowait({'record': record, 'author_did': commit.repo, 'post_uri': post_uri})
                    logger.info(f"Fast-queued candidate post: {post_uri}")
                except asyncio.QueueFull:
                    logger.warning("Queue full, dropping post.")

    except Exception as e:
        logger.error(f"Firehose error: {e}")

async def main():
    logger.info(f"Initializing Intelligence Ingestion System... (Timezone: {DEFAULT_TZ_STR})")
    
    conn_str = get_db_conn_str()
    try:
        async with AsyncConnectionPool(conninfo=conn_str, min_size=2, max_size=MAX_WORKERS+1) as pool:
            await initialize_database(pool)
            
            if os.getenv("CI") == "true":
                logger.info("CI environment detected. Skipping OpenAI context vectorization.")
            else:
                await load_and_vectorize_context()

            queue = asyncio.Queue(maxsize=MAX_QUEUE_SIZE)
            
            async with aiohttp.ClientSession() as session:
                workers = [asyncio.create_task(worker(queue, session, pool)) for _ in range(MAX_WORKERS)]
                
                client = AsyncFirehoseSubscribeReposClient()
                async def handler(message):
                    await on_message_handler(message, queue)
                    
                logger.info("Connecting to Bluesky Firehose...")
                try:
                    await client.start(handler)
                except Exception as e:
                    logger.error(f"Firehose client error: {e}")
                finally:
                    for w in workers: w.cancel()
    except Exception as e:
        logger.critical(f"FATAL SYSTEM ERROR: {e}", exc_info=True)
        raise

if __name__ == "__main__":
    asyncio.run(main())
