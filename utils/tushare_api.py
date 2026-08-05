"""Small, credential-safe client for the current Tushare Pro HTTP API.

The released ``tushare`` package in some environments still points at the
legacy ``api.waditu.com/dataapi`` host.  The official client uses the current
``api.tushare.pro`` endpoint and posts the same request envelope directly to
that endpoint.  Keeping this adapter in the project lets every script share
one endpoint without persisting a token through ``ts.set_token``.
"""

from __future__ import annotations

import os
from functools import partial
from typing import Any

import pandas as pd
import requests


DEFAULT_TUSHARE_API_URL = "https://api.tushare.pro"


class TushareProClient:
    """Dynamic endpoint client compatible with ``ts.pro_api()`` calls."""

    def __init__(self, token: str, timeout: int = 30, api_url: str | None = None):
        if not token:
            raise ValueError("Missing TUSHARE_TOKEN")
        self._token = token
        self._timeout = timeout
        self.api_url = (api_url or os.getenv("TUSHARE_API_URL") or DEFAULT_TUSHARE_API_URL).rstrip("/")

    def query(self, api_name: str, fields: str = "", **kwargs: Any) -> pd.DataFrame:
        payload = {
            "api_name": api_name,
            "token": self._token,
            "params": kwargs,
            "fields": fields,
        }
        response = requests.post(self.api_url, json=payload, timeout=self._timeout)
        response.raise_for_status()
        result = response.json()
        if result.get("code") != 0:
            raise RuntimeError(result.get("msg") or f"Tushare {api_name} failed")
        data = result.get("data") or {}
        return pd.DataFrame(data.get("items", []), columns=data.get("fields", []))

    def __getattr__(self, name: str):
        return partial(self.query, name)


def create_tushare_pro(token: str, timeout: int = 30) -> TushareProClient:
    """Create an in-memory Tushare client without writing credentials to disk."""

    return TushareProClient(token=token, timeout=timeout)
