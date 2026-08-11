"""Transport-neutral stable application errors."""


class ApplicationError(Exception):
    """A public application outcome with a stable HTTP/code mapping."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(code)
