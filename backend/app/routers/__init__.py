"""API routers, grouped by domain.

`ALL_ROUTERS` is the registration order used by main.create_app(); it is also the
order routes appear in the generated OpenAPI document.
"""
from . import analytics, fir, intelligence, socioeconomic, system

ALL_ROUTERS = (
    system.router,
    analytics.router,
    intelligence.router,
    fir.router,
    socioeconomic.router,
)

__all__ = ["ALL_ROUTERS", "analytics", "fir", "intelligence", "socioeconomic", "system"]
