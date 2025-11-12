import json
import os
from dataclasses import dataclass
from threading import Lock
from typing import Any, Dict, List, Optional

try:
    import requests  # type: ignore
except ImportError:  # pragma: no cover - exercised in tests without requests
    requests = None  # type: ignore
    from urllib import request as urllib_request
    from urllib.error import HTTPError, URLError
else:
    urllib_request = None  # type: ignore
    HTTPError = URLError = None  # type: ignore


@dataclass
class ApiUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


@dataclass
class ApiResponse:
    content: str
    usage: Optional[ApiUsage] = None


class _SimpleHTTPResponse:
    """Fallback response object mimicking requests.Response."""

    def __init__(self, status_code: int, text: str) -> None:
        self.status_code = status_code
        self.text = text

    def json(self) -> Dict[str, Any]:
        return json.loads(self.text)


def _http_post(url: str, headers: Dict[str, str], data: str, timeout: int):
    """
    Send an HTTP POST request using requests when available, otherwise urllib.
    """

    if requests is not None:
        try:
            return requests.post(
                url,
                headers=headers,
                data=data,
                timeout=timeout,
            )
        except requests.RequestException as exc:
            raise RuntimeError(f"HTTP request failed: {exc}") from exc

    assert urllib_request is not None, "urllib fallback is unavailable"

    req = urllib_request.Request(
        url,
        data=data.encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib_request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return _SimpleHTTPResponse(resp.getcode(), body)
    except HTTPError as err:
        body = err.read().decode("utf-8")
        return _SimpleHTTPResponse(err.code, body)
    except URLError as err:
        raise RuntimeError(f"HTTP request failed: {err}") from err


class GPT:
    """
    Lightweight GPT client extracted from FlagEvalMM so this project can run without it.
    Only the pieces needed by classify_question.py are implemented.
    """

    def __init__(
        self,
        model_name: str,
        chat_name: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: float = 0.0,
        api_key: Optional[str] = None,
        url: Optional[str] = None,
        json_mode: bool = False,
    ) -> None:
        self.model_name = model_name
        self.chat_name = chat_name or model_name
        self.json_mode = json_mode

        self.chat_args: Dict[str, Any] = {}
        if temperature is not None:
            self.chat_args["temperature"] = temperature
        if max_tokens is not None:
            self.chat_args["max_tokens"] = max_tokens
        if json_mode:
            self.chat_args["response_format"] = {"type": "json_object"}

        self.api_key = api_key 
        self.url = url
        if not self.url:
            raise ValueError("A base URL is required to call the GPT HTTP API.")

        if self.api_key is None:
            raise ValueError("An API key is required to call the GPT HTTP API.")

        self.headers = {"Content-Type": "application/json"}
        if "azure.com" in self.url.lower():
            self.headers["api-key"] = self.api_key
        else:
            self.headers["Authorization"] = f"Bearer {self.api_key}"

    def build_message(
        self,
        query: str,
        system_prompt: Optional[str] = None,
        past_messages: Optional[List[Dict[str, Any]]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Build a chat completion payload. Only textual content is supported in this lightweight version.
        """

        if self.json_mode:
            needs_hint = "json" not in query.lower()
            if system_prompt:
                needs_hint = needs_hint and "json" not in system_prompt.lower()
            if needs_hint:
                extra = "respond with a strict json object."
                if system_prompt:
                    if not system_prompt.endswith(" "):
                        system_prompt += " "
                    system_prompt += extra
                else:
                    system_prompt = extra.capitalize()

        messages: List[Dict[str, Any]] = []
        if past_messages:
            messages.extend(past_messages)
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": query})
        return messages

    def infer(self, messages: List[Dict[str, Any]], **kwargs: Any) -> str:
        """
        Run a chat completion and return the response text content.
        """

        call_args = {**self.chat_args, **kwargs}
        payload = {"model": self.model_name, "messages": messages, **call_args}

        serialized_payload = json.dumps(payload)
        response = None
        last_error: Optional[Exception] = None
        for _ in range(2):
            try:
                response = _http_post(
                    self.url,
                    headers=self.headers,
                    data=serialized_payload,
                    timeout=300,
                )
                break
            except Exception as exc:
                raise RuntimeError(f"HTTP request to GPT failed: {exc}") from exc

        if response is None:
            assert last_error is not None
            raise RuntimeError(f"HTTP request to GPT failed: {last_error}") from last_error

        try:
            response_json = response.json()
        except ValueError as exc:
            raise RuntimeError(f"Failed to decode GPT response: {response.text}") from exc

        if response.status_code != 200:
            error_message = response_json.get("error") or response_json.get("message") or response.text
            raise RuntimeError(f"GPT request failed with status {response.status_code}: {error_message}")

        usage = None
        raw_usage = response_json.get("usage")
        if raw_usage:
            usage = ApiUsage(
                prompt_tokens=raw_usage.get("prompt_tokens", 0),
                completion_tokens=raw_usage.get("completion_tokens", 0),
                total_tokens=raw_usage.get("total_tokens", 0),
            )

        content = ""
        if "choices" in response_json:
            message = response_json["choices"][0]["message"]
            content = (message.get("content") or "").strip()
        elif "completions" in response_json:
            content = response_json["completions"][0].get("text", "").strip()

        result = ApiResponse(content=content, usage=usage)

        return result.content

if __name__ == "__main__":
    model = GPT(
        model_name="openai/gpt-5-mini",
        temperature=0.0,
        json_mode=True,
        api_key=os.getenv("FLAGEVAL_API_KEY"),
        url=os.getenv("FLAGEVAL_URL"),
    )
    message = model.build_message(
        query="Tell a joke about gemini 3 pro and claude."
    )
    response = model.infer(message)
    print(response)
