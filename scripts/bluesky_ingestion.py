import os
import asyncio
import logging
import psycopg
from psycopg import AsyncConnection

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def get_async_db_connection():
    """Returns an asynchronous connection to the PostgreSQL database with retry logic."""
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "postgres")
    db_name = os.getenv("POSTGRES_DB", "bsis")
    host = os.getenv("POSTGRES_HOST", "db")
    port = os.getenv("POSTGRES_PORT", "5432")

    conn_str = f"postgresql://{user}:{password}@{host}:{port}/{db_name}"
    
    retries = 10
    while retries > 0:
        try:
            # Use AsyncConnection.connect for non-blocking connection
            conn = await AsyncConnection.connect(conn_str)
            logger.info("Successfully connected to the database.")
            return conn
        except Exception as e:
            logger.warning(f"Database connection failed ({retries} retries left): {e}")
            retries -= 1
            await asyncio.sleep(5)
    
    raise Exception("Could not connect to the database after multiple retries.")

async def list_tables(conn):
    """Fetches and logs all table names from the current database schema asynchronously."""
    try:
        async with conn.cursor() as cur:
            # Query to get all table names in the public schema
            await cur.execute("""
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                ORDER BY table_name;
            """)
            tables = await cur.fetchall()
            
            if not tables:
                logger.info("No tables found in the 'public' schema.")
            else:
                table_names = [table[0] for table in tables]
                logger.info(f"Tables in database: {', '.join(table_names)}")
    except Exception as e:
        logger.error(f"Failed to retrieve table names: {e}")

async def main():
    logger.info("Starting Bluesky ingestion background script...")
    
    conn = None
    try:
        conn = await get_async_db_connection()
        await list_tables(conn)
        
        # Keep the script running to satisfy Docker health checks
        while True:
            await asyncio.sleep(60)

    except Exception as e:
        logger.error(f"Critical error in main loop: {e}")
    finally:
        if conn:
            await conn.close()
            logger.info("Database connection closed.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        logger.info(f"Error in main loop: {str(e)}")
