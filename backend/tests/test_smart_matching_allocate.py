"""Unit tests for smart matching allocation helpers."""
import pytest

from smart_matching import (
    _allocate_within_day,
    _allocate_single_therapist,
    _align_weekday_anchor,
    _fits_in_day_blocks,
)


def test_allocate_within_day_earliest_full_window():
    """Earliest contiguous segment that fits the whole target wins."""
    # Two equal 2h windows; must pick the earlier one.
    blocks = [(17 * 60 + 30, 19 * 60 + 30), (15 * 60, 17 * 60)]
    out = _allocate_within_day(blocks, 2.0)
    assert out == [(15 * 60, 17 * 60)]


def test_fits_in_day_blocks():
    assert _fits_in_day_blocks([(900, 1170)], 900, 1020) is True
    assert _fits_in_day_blocks([(900, 1000), (1020, 1170)], 900, 1020) is False


def test_align_weekday_anchor_snaps_to_monday():
    """When Tue–Fri can host Monday's slot, proposals align to the same clock time."""
    free_by_day = {
        0: {"blocks": [(15 * 60, 19 * 60 + 30)]},
        1: {"blocks": [(15 * 60, 19 * 60 + 30)]},
        2: {"blocks": [(15 * 60, 19 * 60 + 30)]},
        3: {"blocks": [(15 * 60, 19 * 60 + 30)]},
        4: {"blocks": [(15 * 60, 19 * 60 + 30)]},
    }
    daily_targets = {0: 2.0, 1: 2.0, 2: 2.0, 3: 2.0, 4: 2.0}
    chosen = [
        (0, 15 * 60, 17 * 60),
        (1, 17 * 60 + 30, 19 * 60 + 30),
        (2, 17 * 60 + 30, 19 * 60 + 30),
        (3, 17 * 60 + 30, 19 * 60 + 30),
        (4, 17 * 60 + 30, 19 * 60 + 30),
    ]
    aligned = _align_weekday_anchor(free_by_day, chosen, daily_targets)
    for day, s, e in aligned:
        assert (s, e) == (15 * 60, 17 * 60), (day, s, e)


def test_allocate_single_therapist_aligns_equal_windows():
    free_by_day = {
        0: {"blocks": [(15 * 60, 17 * 60), (17 * 60 + 30, 19 * 60 + 30)]},
        1: {"blocks": [(15 * 60, 17 * 60), (17 * 60 + 30, 19 * 60 + 30)]},
        2: {"blocks": [(15 * 60, 17 * 60), (17 * 60 + 30, 19 * 60 + 30)]},
        3: {"blocks": [(15 * 60, 17 * 60), (17 * 60 + 30, 19 * 60 + 30)]},
        4: {"blocks": [(15 * 60, 17 * 60), (17 * 60 + 30, 19 * 60 + 30)]},
    }
    daily_targets = {0: 2.0, 1: 2.0, 2: 2.0, 3: 2.0, 4: 2.0}
    chosen = _allocate_single_therapist(free_by_day, 10.0, daily_targets)
    for day, s, e in chosen:
        assert (s, e) == (15 * 60, 17 * 60), (day, s, e)
