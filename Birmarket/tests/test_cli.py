from pathlib import Path

import pandas as pd

from birmarket.cli import save_snapshot


def test_save_snapshot_csv(tmp_path: Path) -> None:
    paths = save_snapshot(
        [{"id": "1", "name": "Product", "price": 2.5}],
        tmp_path,
        ["csv"],
    )

    assert len(paths) == 1
    assert paths[0].suffix == ".csv"
    frame = pd.read_csv(paths[0], dtype={"id": str})
    assert frame.to_dict("records") == [{"id": "1", "name": "Product", "price": 2.5}]
