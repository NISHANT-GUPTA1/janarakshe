"""Socio-economic correlation routes (real Census 2011 indicators)."""
from __future__ import annotations

from fastapi import APIRouter

from .. import payloads

router = APIRouter(prefix="/api/socioeconomic", tags=["socioeconomic"])


@router.get("", summary="Socio-economic indicators")
def indicators():
    """Per-district socio-economic indicators (Census 2011)."""
    return payloads.load("se_indicators.json")


@router.get("/correlations", summary="Indicator-crime correlation matrix")
def correlations():
    """Correlation matrix: each indicator x each crime group (Pearson/Spearman,
    p-values, hypothesis verdicts) + ethical caveats."""
    return payloads.load("se_correlations.json")


@router.get("/intelligence", summary="Socio-economic intelligence")
def intelligence():
    """District profiles banded against the other districts and the state figure,
    the associations that carry signal stated in plain language with their limits,
    nearest-profile districts, and the full correlation matrix + methodology behind
    them for the analyst view."""
    return payloads.load("se_intel.json")


@router.get("/schema", summary="Indicator definitions and hypotheses")
def schema():
    """The logically-backed indicator definitions + crime hypotheses."""
    return payloads.load("se_schema.json")
