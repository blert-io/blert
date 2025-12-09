#!/usr/bin/env python3
"""
Generates the challenge-stage-processing-metrics Grafana dashboard.

Usage:
    python tools/generate_stage_dashboard.py

Writes the dashboard JSON to docker/grafana/dashboards/challenge-stage-processing-metrics.json.
"""
from __future__ import annotations

import json
from pathlib import Path

STAGES = [
    ("tob_maiden", "Maiden"),
    ("tob_bloat", "Bloat"),
    ("tob_nylocas", "Nylocas"),
    ("tob_sotetseg", "Sotetseg"),
    ("tob_xarpus", "Xarpus"),
    ("tob_verzik", "Verzik"),
    ("colosseum_any", "Colosseum"),
    ("inferno_any", "Inferno"),
    ("mokhaiotl_any", "Mokhaiotl"),
]

PANEL_HEIGHT = 6
PANEL_WIDTH = 8
COLUMNS = 3


def panel_common(
    row: int,
    column: int,
    title: str,
    targets,
    unit: str,
    panel_id: int,
    fill=20,
    stack=False,
    smooth=True,
    color_map: dict[str, str] | None = None,
):
    overrides = []
    if color_map is not None:
        for name, color in color_map.items():
            overrides.append(
                {
                    "matcher": {"id": "byName", "options": name},
                    "properties": [
                        {
                            "id": "color",
                            "value": {"fixedColor": color, "mode": "fixed"},
                        },
                    ],
                }
            )

    return {
        "datasource": {"type": "prometheus", "uid": "${DS_PROMETHEUS}"},
        "fieldConfig": {
            "defaults": {
                "color": {"mode": "palette-classic"},
                "custom": {
                    "axisBorderShow": False,
                    "axisCenteredZero": False,
                    "axisColorMode": "text",
                    "axisPlacement": "auto",
                    "barAlignment": 0,
                    "drawStyle": "line",
                    "fillOpacity": fill,
                    "gradientMode": "none",
                    "lineInterpolation": "smooth" if smooth else "linear",
                    "lineWidth": 2,
                    "pointSize": 4,
                    "scaleDistribution": {"type": "linear"},
                    "showPoints": "auto",
                    "spanNulls": True,
                    "stacking": {"group": "A", "mode": "normal" if stack else "none"},
                    "thresholdsStyle": {"mode": "off"},
                },
                "unit": unit,
            },
            "overrides": overrides,
        },
        "gridPos": {
            "h": PANEL_HEIGHT,
            "w": PANEL_WIDTH,
            "x": column * PANEL_WIDTH,
            "y": row * (PANEL_HEIGHT * 3) + (column * PANEL_HEIGHT),
        },
        "id": panel_id,
        "options": {
            "legend": {
                "calcs": [],
                "displayMode": "list",
                "placement": "bottom",
                "showLegend": True,
            },
            "tooltip": {"mode": "multi", "sort": "none"},
        },
        "targets": targets,
        "title": title,
        "type": "timeseries",
    }


def main() -> None:
    panels = []
    panel_id = 1

    for row, (stage, label) in enumerate(STAGES):
        # Latency
        panels.append(
            panel_common(
                row,
                0,
                f"{label} latencies (30m)",
                [
                    {
                        "expr": f'histogram_quantile(0.9, sum by (le) (rate(challenge_server_stage_processing_duration_ms_bucket{{stage="{stage}"}}[30m])))',
                        "legendFormat": "processing p90",
                        "refId": "A",
                    },
                    {
                        "expr": f'histogram_quantile(0.5, sum by (le) (rate(challenge_server_stage_processing_duration_ms_bucket{{stage="{stage}"}}[30m])))',
                        "legendFormat": "processing p50",
                        "refId": "B",
                    },
                    {
                        "expr": f'histogram_quantile(0.9, sum by (le) (rate(challenge_server_merge_duration_ms_bucket{{stage="{stage}"}}[30m])))',
                        "legendFormat": "merge p90",
                        "refId": "C",
                    },
                    {
                        "expr": f'histogram_quantile(0.5, sum by (le) (rate(challenge_server_merge_duration_ms_bucket{{stage="{stage}"}}[30m])))',
                        "legendFormat": "merge p50",
                        "refId": "D",
                    },
                ],
                "ms",
                panel_id=panel_id,
                color_map={
                    "processing p90": "orange",
                    "processing p50": "semi-dark-green",
                    "merge p90": "dark-blue",
                    "merge p50": "semi-dark-purple",
                },
            )
        )
        panel_id += 1

        # Per-client payload
        panels.append(
            panel_common(
                row,
                1,
                f"{label} average per-client payload (30m)",
                [
                    {
                        "expr": f'histogram_quantile(0.9, sum by (le) (rate(challenge_server_stage_event_payload_per_client_bytes_bucket{{stage="{stage}"}}[30m])))',
                        "legendFormat": "payload p90",
                        "refId": "A",
                    },
                    {
                        "expr": f'histogram_quantile(0.5, sum by (le) (rate(challenge_server_stage_event_payload_per_client_bytes_bucket{{stage="{stage}"}}[30m])))',
                        "legendFormat": "payload p50",
                        "refId": "B",
                    },
                ],
                "bytes",
                panel_id=panel_id,
                fill=10,
                color_map={
                    "payload p90": "light-red",
                    "payload p50": "dark-green",
                },
            )
        )
        panel_id += 1

        # Merge issues
        panels.append(
            panel_common(
                row,
                2,
                f"{label} merge issues (30m)",
                [
                    {
                        "expr": f'sum(increase(challenge_server_merge_alerts_total{{stage="{stage}"}}[30m]))',
                        "legendFormat": "merge alerts",
                        "refId": "A",
                    },
                    {
                        "expr": f'sum(increase(challenge_server_client_anomalies_total{{stage="{stage}"}}[30m]))',
                        "legendFormat": "client anomalies",
                        "refId": "B",
                    },
                ],
                "count",
                panel_id=panel_id,
                fill=15,
                stack=True,
                smooth=False,
                color_map={
                    "merge alerts": "semi-dark-red",
                    "client anomalies": "semi-dark-yellow",
                },
            )
        )
        panel_id += 1

    dashboard = {
        "annotations": {
            "list": [
                {
                    "builtIn": 1,
                    "datasource": {"type": "grafana", "uid": "-- Grafana --"},
                    "enable": True,
                    "hide": True,
                    "iconColor": "rgba(0, 211, 255, 1)",
                    "name": "Annotations & Alerts",
                    "type": "dashboard",
                }
            ]
        },
        "editable": True,
        "fiscalYearStartMonth": 0,
        "graphTooltip": 0,
        "id": None,
        "links": [],
        "panels": panels,
        "preload": False,
        "refresh": "10s",
        "schemaVersion": 42,
        "tags": ["metrics", "challenge-server", "stage"],
        "templating": {
            "list": [
                {
                    "current": {"text": "Prometheus", "value": "Prometheus"},
                    "name": "DS_PROMETHEUS",
                    "options": [],
                    "query": "prometheus",
                    "refresh": 1,
                    "type": "datasource",
                }
            ]
        },
        "time": {"from": "now-3h", "to": "now"},
        "timepicker": {},
        "timezone": "",
        "title": "Challenge Stage Processing Metrics",
        "uid": "challenge-stage-processing-metrics",
        "version": 1,
    }

    output_path = Path(
        "docker/grafana/dashboards/challenge-stage-processing-metrics.json"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(dashboard, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
