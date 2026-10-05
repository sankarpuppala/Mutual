"""The uniform error body ``{"error": "<code>", "message": "<text>"}`` (SPEC.md §11)."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


_DEFAULT_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "too_large",
    422: "validation_error",
    425: "too_early",
    429: "rate_limited",
}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"error": exc.code, "message": exc.message}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Never echo submitted values back (they may include a date of birth).
        fields = [".".join(str(p) for p in e.get("loc", ()) if p != "body") for e in exc.errors()]
        joined = ", ".join(sorted({f for f in fields if f}))
        message = f"invalid fields: {joined}" if joined else "invalid request"
        return JSONResponse({"error": "validation_error", "message": message}, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _DEFAULT_CODES.get(exc.status_code, "error")
        return JSONResponse(
            {"error": code, "message": str(exc.detail)}, status_code=exc.status_code
        )
