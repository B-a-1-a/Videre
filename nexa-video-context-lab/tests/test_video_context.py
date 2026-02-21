from pathlib import Path

from nexa_video_context_lab.video_context import (
    choose_evenly_spaced_frames,
    extract_first_json_object,
    find_matches,
    format_timecode,
    parse_float_time,
    parse_ranges_arg,
    score_query_match,
    FrameSample,
)


def test_parse_float_time() -> None:
    assert parse_float_time("12.5") == 12.5
    assert parse_float_time("01:02") == 62.0
    assert parse_float_time("01:02:03.5") == 3723.5
    assert parse_float_time("bad") is None


def test_parse_ranges_arg() -> None:
    ranges = parse_ranges_arg("00:00:10-00:00:12.5,20-21")
    assert ranges == [(10.0, 12.5), (20.0, 21.0)]


def test_extract_first_json_object_from_fence() -> None:
    text = '```json\n{"summary":"A","actions":["walk"]}\n```'
    obj = extract_first_json_object(text)
    assert obj == {"summary": "A", "actions": ["walk"]}


def test_find_matches() -> None:
    sections = [
        {
            "section_id": "s001",
            "start": 0,
            "end": 10,
            "summary": "A person enters a room and waves",
            "actions": ["entering", "waving"],
            "objects": ["door", "desk"],
        },
        {
            "section_id": "s002",
            "start": 10,
            "end": 20,
            "summary": "Quiet landscape shot",
            "actions": ["static"],
            "objects": ["trees"],
        },
    ]
    matches = find_matches(sections=sections, query="person waving", top_k=3, min_score=0.01)
    assert matches[0]["section_id"] == "s001"
    assert matches[0]["score"] > 0


def test_choose_evenly_spaced_frames() -> None:
    frames = [FrameSample(index=i, timestamp=float(i), path=Path(f"/tmp/frame_{i:02d}.jpg")) for i in range(10)]
    selected = choose_evenly_spaced_frames(frames, max_count=4)
    assert len(selected) == 4
    assert selected[0].index == 0
    assert selected[-1].index == 9


def test_misc_helpers() -> None:
    assert format_timecode(61.234) == "00:01:01.234"
    assert score_query_match("person waves", "A person waves to the camera") > 0
