"""Domain errors. The app maps each one to an HTTP status in `main.py`."""


class MinerError(Exception):
    """Base class for errors that are safe to show to the caller."""

    status_code = 400


class InvalidEventsError(MinerError):
    """The event data does not satisfy the event contract."""

    status_code = 422


class InvalidModelError(MinerError):
    """A reference model (BPMN XML or happy variants) is unusable."""

    status_code = 422


class PayloadTooLargeError(MinerError):
    """A body, download or upload exceeds a configured limit."""

    status_code = 413


class EventsUrlError(MinerError):
    """`events_url` is not allowed, or fetching it failed."""

    status_code = 400


class UpstreamFetchError(MinerError):
    """The storage host answered `events_url` with an error."""

    status_code = 502
