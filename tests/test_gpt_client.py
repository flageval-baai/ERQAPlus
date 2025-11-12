import json
import unittest
from unittest.mock import patch

import gpt_client
from gpt_client import GPT


class TestGPTClient(unittest.TestCase):
    def _make_model(self, **overrides):
        defaults = dict(
            model_name="fake-model",
            temperature=0.0,
            api_key="key",
            url="https://example.com/v1/chat",
            json_mode=False,
        )
        defaults.update(overrides)
        return GPT(**defaults)

    def test_build_message_includes_system_prompt_and_history(self):
        past = [{"role": "user", "content": "earlier"}]
        model = self._make_model(json_mode=False)
        messages = model.build_message("current", system_prompt="system", past_messages=past)

        self.assertEqual(
            messages,
            [
                {"role": "user", "content": "earlier"},
                {"role": "system", "content": "system"},
                {"role": "user", "content": "current"},
            ],
        )

    def test_build_message_appends_json_hint_when_needed(self):
        model = self._make_model(json_mode=True)
        messages = model.build_message("tell me something")
        self.assertIn("json", messages[0]["content"].lower())

    def test_infer_uses_cache_with_http_client(self):
        call_count = {"value": 0}

        def fake_post(url, headers, data, timeout):
            call_count["value"] += 1
            payload = {
                "choices": [
                    {"message": {"content": f"response-{call_count['value']}"}}
                ],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 2,
                    "total_tokens": 3,
                },
            }

            class _FakeResponse:
                status_code = 200

                def __init__(self, json_payload):
                    self._payload = json_payload
                    self.text = json.dumps(json_payload)

                def json(self):
                    return self._payload

            return _FakeResponse(payload)

        with patch("gpt_client._http_post", side_effect=fake_post):
            model = self._make_model(json_mode=True)
            messages = model.build_message("hello")

            first = model.infer(messages)
            second = model.infer(messages)

            self.assertEqual(first, "response-1")
            self.assertEqual(second, "response-1")
            self.assertEqual(call_count["value"], 1)

    def test_infer_retries_on_chunked_error(self):
        responses = [
            gpt_client.ChunkedResponseError("chunked fail"),
            self._build_fake_response("ok"),
        ]

        def fake_post(url, headers, data, timeout):
            result = responses.pop(0)
            if isinstance(result, Exception):
                raise result
            return result

        with patch("gpt_client._http_post", side_effect=fake_post):
            model = self._make_model()
            messages = model.build_message("hi there json please")
            result = model.infer(messages)
            self.assertEqual(result, "ok")

    def _build_fake_response(self, text):
        payload = {"choices": [{"message": {"content": text}}]}

        class _FakeResponse:
            status_code = 200

            def __init__(self, json_payload):
                self._payload = json_payload
                self.text = json.dumps(json_payload)

            def json(self):
                return self._payload

        return _FakeResponse(payload)


if __name__ == "__main__":
    unittest.main()
