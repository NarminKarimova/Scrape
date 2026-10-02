import pandas as pd
import os
import logging
from typing import Optional

# Configure logging
logger = logging.getLogger(__name__)

def generate_report(history_file: Optional[str] = None) -> Optional[pd.DataFrame]:
    """
    Generates an inflation report by comparing the latest month's prices with the previous month.
    
    Args:
        history_file: Path to the CSV file containing price history snapshots.
        
    Returns:
        Optional[pd.DataFrame]: A DataFrame containing the comparison results, or None if data is insufficient.
    """
    if history_file is None:
        logger.error("No history file provided. Please specify a snapshot file.")
        return None

    if not os.path.exists(history_file):
        logger.error(f"History file {history_file} not found. Run 'scrape' first.")
        return None

    try:
        df = pd.read_csv(history_file)
        if df.empty:
            logger.warning("History file is empty.")
            return None
            
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df['month'] = df['timestamp'].dt.strftime('%Y-%m')
        
        months = sorted(df['month'].unique(), reverse=True)
        
        if len(months) < 2:
            logger.info("Not enough data for monthly comparison. Need at least two different months.")
            return None
        
        latest_month = months[0]
        prev_month = months[1]
        
        logger.info(f"Comparing {latest_month} with {prev_month}...")
        
        # Aggregate by ID to handle multiple scrapes in the same month
        latest_df = df[df['month'] == latest_month].groupby('id').agg({
            'name': 'first',
            'price': 'mean',
            'base_price': 'mean',
            'discount_percent': 'mean',
            'brand': 'first',
            'category': 'first'
        }).rename(columns={'price': 'new_price', 'base_price': 'new_base_price'})
        
        prev_df = df[df['month'] == prev_month].groupby('id').agg({
            'price': 'mean',
            'base_price': 'mean'
        }).rename(columns={'price': 'old_price', 'base_price': 'old_base_price'})
        
        comparison = latest_df.join(prev_df, how='inner')
        
        if comparison.empty:
            logger.warning("No overlapping products found between the two months.")
            return None

        # Actual price change (includes discounts)
        comparison['change_percent'] = ((comparison['new_price'] - comparison['old_price']) / comparison['old_price']) * 100
        # Base price change (ignores temporary discounts)
        comparison['base_change_percent'] = ((comparison['new_base_price'] - comparison['old_base_price']) / comparison['old_base_price']) * 100
        
        comparison = comparison.sort_values('change_percent', ascending=False)
        
        print("\n" + "="*50)
        print("--- Inflation Report (Monthly Price Changes) ---")
        print(f"Total products compared: {len(comparison)}")
        print(f"Average actual price change: {comparison['change_percent'].mean():.2f}%")
        print(f"Average base price change: {comparison['base_change_percent'].mean():.2f}%")
        print("="*50)
        
        print("\nTop 10 Price Increases (Actual):")
        print(comparison.head(10)[['name', 'old_price', 'new_price', 'change_percent']])
        
        print("\nTop 10 Base Price Increases (Standard Price):")
        base_increases = comparison.sort_values('base_change_percent', ascending=False)
        print(base_increases.head(10)[['name', 'old_base_price', 'new_base_price', 'base_change_percent']])
        
        print("\nTop 10 Price Decreases:")
        print(comparison.tail(10)[['name', 'old_price', 'new_price', 'change_percent']])
        
        report_file = "inflation_report.csv"
        comparison.to_csv(report_file)
        logger.info(f"Full report saved to {report_file}")
        
        return comparison

    except Exception as e:
        logger.error(f"Error generating report: {e}")
        return None

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    generate_report()

