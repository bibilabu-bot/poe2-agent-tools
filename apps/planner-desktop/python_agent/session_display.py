"""Redact credential-shaped fields and the configured secret before new persistence."""
import json
import re
from typing import Any


def redact(value: Any, secret: str = "", depth: int = 0) -> Any:
    if depth > 30:
        return "[已隐藏]"
    if isinstance(value, str):
        clean = value.replace(secret, "[已隐藏]") if secret else value
        try:
            parsed = json.loads(clean)
            if isinstance(parsed, (dict, list)):
                return json.dumps(redact(parsed, secret, depth+1), ensure_ascii=False)
        except (ValueError, TypeError):
            pass
        return re.sub(r"(?i)(?:sk-[\w-]+|bearer\s+\S+|(?:api[_ -]?key|密钥)\s*[:=：]\s*\S+)", "[已隐藏]", clean)
    if isinstance(value, list):
        return [redact(item, secret, depth+1) for item in value]
    if isinstance(value, dict):
        return {key: "[已隐藏]" if re.search(r"(?i)(api.?key|authorization|password|secret|token|credential)", key)
                else redact(item, secret, depth+1) for key, item in value.items()}
    return value
