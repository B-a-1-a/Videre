from nexa_caption_lab.caption_video import (
    extract_caption_segments,
    format_srt_time,
    format_vtt_time,
)


def test_time_formatters() -> None:
    assert format_srt_time(0.0) == "00:00:00,000"
    assert format_srt_time(61.234) == "00:01:01,234"
    assert format_vtt_time(61.234) == "00:01:01.234"


def test_extract_segments_from_segment_payload() -> None:
    payload = {
        "segments": [
            {"start": 0.0, "end": 1.1, "text": "Hello"},
            {"timestamps": [1.1, 2.5], "text": "world"},
        ]
    }
    segments = extract_caption_segments(payload)
    assert len(segments) == 2
    assert segments[0].text == "Hello"
    assert segments[1].start == 1.1
    assert segments[1].end == 2.5


def test_extract_segments_from_word_payload() -> None:
    payload = {
        "result": {
            "words": [
                {"word": "hello", "start_time": "0.00", "end_time": "0.55"},
                {"word": "there", "start_time": "0.55", "end_time": "1.00"},
            ]
        }
    }
    segments = extract_caption_segments(payload)
    assert [segment.text for segment in segments] == ["hello", "there"]


def test_extract_segments_from_transcribe_result_shape() -> None:
    payload = {
        "transcript": "hello there",
        "timestamps": [[0.0, 0.55], [0.55, 1.0]],
    }
    segments = extract_caption_segments(payload)
    assert len(segments) == 2
    assert segments[0].text == "hello"
    assert segments[1].text == "there"
