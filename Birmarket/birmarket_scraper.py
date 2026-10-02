"""Convenient direct entry point for the BirMarket scraper."""

import sys

from birmarket.cli import main

#“Did the user run this file directly?”
if __name__ == "__main__":
    raise SystemExit(main(["scrape", *sys.argv[1:]]))

#when you run this file # Inside birmarket_scraper.py
#__name__ == "__main__"

# Inside cli.py
#__name__ == "birmarket.cli"