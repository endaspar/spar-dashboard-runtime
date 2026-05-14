/**
 * Standalone SPAR manifest dashboard renderer (browser).
 * Load after: SPAR design CSS (includes grid chrome), Chart.js, ag-grid-community, spar-dash-transform.js
 * Mirrors src/components/spar-dash/spar-manifest-runtime.tsx (subset; evolve together).
 * @version spar-dash-engine@1
 */
(function (global) {
  'use strict';

  var CHART_TYPES = {
    bar_h: 1,
    bar_v: 1,
    bar_h_diverging: 1,
    bar_grouped: 1,
    stacked_bar: 1,
    line_multi: 1,
    stacked_area: 1,
    stacked_area_pct: 1,
    pie: 1,
  };

  function compactUsd(n) {
    var sign = n < 0 ? '-' : '';
    var v = Math.abs(n);
    if (v >= 1e9) return sign + '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return sign + '$' + (v / 1e6).toFixed(2) + 'M';
    if (v >= 1e3) return sign + '$' + (v / 1e3).toFixed(2) + 'K';
    return sign + '$' + v.toFixed(2);
  }

  /* Smart fallback formatter applied when no explicit `format` is set on the
     column / KPI. Mirror of `autoFormatValue` in src/lib/spar-dash-engine/format.ts.
       1. Date-shaped strings (`^YYYY-MM-DD…`): always strip sub-second
          precision; if remaining time is `00:00:00`, strip the time entirely
          (so a datetime column at midnight renders as `2026-05-09`, not
          `2026-05-09 00:00:00.000000`).
       2. Numbers with > 3 decimals: round to 3 decimals and drop trailing
          zeros (`0.5679999999` → `0.568`). Integers are NEVER touched (no
          auto-thousand-separators — would mangle ID-style numeric columns).
          Tiny values (`|x| < 0.001`) are left alone so `0.000123` is not
          rendered as `0`.
     Authors can always override by setting an explicit `format`. */
  function autoFormatValue(value) {
    if (typeof value === 'string') {
      var dm = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(.*))?$/);
      if (dm) {
        var datePart = dm[1];
        var timePart = dm[2];
        var tail = dm[3] || '';
        if (!timePart) return datePart;
        if (timePart === '00:00:00' && !tail.replace(/\s/g, '')) return datePart;
        return datePart + ' ' + timePart + tail;
      }
      var trimmed = value.trim();
      if (trimmed && !isNaN(Number(trimmed))) {
        var n = Number(trimmed);
        if (isFinite(n) && !Number.isInteger(n) && Math.abs(n) >= 0.001) {
          var dotIdx = trimmed.indexOf('.');
          if (dotIdx >= 0 && trimmed.length - dotIdx - 1 > 3) {
            return String(Number(n.toFixed(3)));
          }
        }
      }
    } else if (typeof value === 'number' && isFinite(value)) {
      if (Number.isInteger(value)) return String(value);
      if (Math.abs(value) < 0.001) return String(value);
      return String(Number(value.toFixed(3)));
    }
    return String(value);
  }

  function formatByName(formatName, value) {
    if (value === null || value === undefined) return '—';
    if (!formatName) return autoFormatValue(value);
    var n = Number(value);
    var isNum =
      typeof value === 'number' ||
      (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value)));
    switch (formatName) {
      case 'usd_compact':
        return isNum ? compactUsd(n) : String(value);
      case 'usd_billions':
        return isNum ? '$' + (n / 1e9).toFixed(2) + 'B' : String(value);
      case 'usd_millions':
        return isNum ? '$' + (n / 1e6).toFixed(2) + 'M' : String(value);
      case 'percent_2':
        return isNum ? (n * 100).toFixed(2) + '%' : String(value);
      case 'percent_1':
        return isNum ? (n * 100).toFixed(1) + '%' : String(value);
      case 'percent_inline':
        return isNum ? Number(value).toFixed(2) + '%' : String(value);
      case 'int':
        return isNum ? Math.round(n).toLocaleString() : String(value);
      case 'date': {
        /* Accept ISO `YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS`, `YYYY-MM-DD HH:MM:SS.fff`,
           or anything `Date` can parse — emit just the date portion. Avoids
           displaying KPI values like `2026-05-09 00:00:00.000000` when the
           backing column is a datetime but the dashboard only cares about the
           date. Falls back to the raw value if nothing parses. */
        var s = String(value).trim();
        var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) return m[1];
        var dt = new Date(s);
        if (!isNaN(dt.getTime())) {
          var y = dt.getUTCFullYear();
          var mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
          var d = String(dt.getUTCDate()).padStart(2, '0');
          return y + '-' + mo + '-' + d;
        }
        return s;
      }
      case 'datetime': {
        /* Render `YYYY-MM-DD HH:MM` (drop sub-second precision and TZ noise). */
        var s2 = String(value).trim();
        var m2 = s2.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
        if (m2) return m2[1] + ' ' + m2[2];
        var dt2 = new Date(s2);
        if (!isNaN(dt2.getTime())) {
          var iso = dt2.toISOString();
          return iso.slice(0, 10) + ' ' + iso.slice(11, 16);
        }
        return s2;
      }
      case 'signed_delta_usd':
        return isNum ? (n >= 0 ? '+' : '') + compactUsd(n) : String(value);
      case 'signed_delta_int':
        return isNum ? (n >= 0 ? '+' : '') + Math.round(n).toLocaleString() : String(value);
      case 'signed_delta_pct':
        return isNum ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : String(value);
      case 'rag_dot': {
        var s = String(value).toLowerCase();
        var color =
          s === 'green' || s === 'g' || s === 'ok'
            ? 'var(--spar-success)'
            : s === 'red' || s === 'r' || s === 'bad'
              ? 'var(--spar-error)'
              : 'var(--spar-warning)';
        return (
          '<span class="spar-rag-dot" style="--rag:' +
          color +
          '" aria-label="' +
          String(value).replace(/"/g, '&quot;') +
          '"></span>'
        );
      }
      default:
        return autoFormatValue(value);
    }
  }

  /* Mirror of `resolveEffectiveFormatName` in src/lib/spar-dash-engine/format.ts */
  function resolveEffectiveFormatName(formatFromParam, staticFormat, paramState) {
    if (!formatFromParam || typeof formatFromParam.param !== 'string' || !formatFromParam.param.trim()) {
      return staticFormat;
    }
    var p = formatFromParam.param.trim();
    var raw = paramState && paramState[p];
    var map = formatFromParam.map;
    if (!map || typeof map !== 'object' || Array.isArray(map)) return staticFormat;
    var key = raw !== undefined && raw !== null ? String(raw) : '';
    if (key && Object.prototype.hasOwnProperty.call(map, key)) {
      var v = map[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    if (typeof formatFromParam.default === 'string' && formatFromParam.default.trim()) {
      return formatFromParam.default.trim();
    }
    return staticFormat;
  }

  /* Mirror of `resolveEffectiveFieldName` in src/lib/spar-dash-engine/format.ts */
  function resolveEffectiveFieldName(fieldFromParam, staticField, paramState) {
    var fallback = typeof staticField === 'string' ? staticField.trim() : '';
    if (!fieldFromParam || typeof fieldFromParam.param !== 'string' || !fieldFromParam.param.trim()) {
      return fallback;
    }
    var p2 = fieldFromParam.param.trim();
    var raw2 = paramState && paramState[p2];
    var map2 = fieldFromParam.map;
    if (!map2 || typeof map2 !== 'object' || Array.isArray(map2)) return fallback;
    var key2 = raw2 !== undefined && raw2 !== null ? String(raw2) : '';
    if (key2 && Object.prototype.hasOwnProperty.call(map2, key2)) {
      var v2 = map2[key2];
      if (typeof v2 === 'string' && v2.trim()) return v2.trim();
    }
    if (typeof fieldFromParam.default === 'string' && fieldFromParam.default.trim()) {
      return fieldFromParam.default.trim();
    }
    return fallback;
  }

  function formatWidgetField(widget, role, value, paramState) {
    var staticFmt;
    var f = widget.format;
    if (typeof f === 'string') staticFmt = f;
    else if (f && typeof f === 'object' && role in f) staticFmt = f[role];
    var eff = resolveEffectiveFormatName(widget.format_from_param, staticFmt, paramState);
    return formatByName(eff, value);
  }

  /* Mirror of `parseNumberLike` in src/lib/spar-dash-engine/format.ts.
     Returns a finite JS number when `value` is number-shaped (after stripping
     currency symbols / thousands commas / percent / accounting parens), else
     `null`. SQL warehouses frequently serialise Decimal columns as strings to
     preserve precision; coercing here lets the smart comparator below sort
     numerically when both cells parse, instead of falling back to AG Grid's
     default lexicographic compare. */
  function parseNumberLike(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    var trimmed = value.trim();
    if (!trimmed) return null;
    var negative = false;
    if (trimmed.length >= 2 && trimmed.charAt(0) === '(' && trimmed.charAt(trimmed.length - 1) === ')') {
      negative = true;
      trimmed = trimmed.slice(1, -1);
    }
    var stripped = trimmed.replace(/[$£€¥¢%,\s]/g, '');
    if (!stripped) return null;
    if (!/^[+-]?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(stripped)) return null;
    var n = Number(stripped);
    if (!isFinite(n)) return null;
    return negative ? -n : n;
  }

  /* Mirror of `smartCellComparator` in src/lib/spar-dash-engine/format.ts.
     Applied via `defaultColDef.comparator` so every grid column auto-detects
     numeric-vs-string sort per pair of values: both number-shaped → numeric
     compare, otherwise lexicographic fallback. Pure-string columns therefore
     keep their natural sort. Null / undefined values sort first in ascending
     order (matches AG Grid's nulls-first default). */
  function smartCellComparator(a, b) {
    if (a === b) return 0;
    if (a === null || a === undefined) return -1;
    if (b === null || b === undefined) return 1;
    var na = parseNumberLike(a);
    var nb = parseNumberLike(b);
    if (na !== null && nb !== null) {
      if (na === nb) return 0;
      return na < nb ? -1 : 1;
    }
    var sa = String(a);
    var sb = String(b);
    if (sa === sb) return 0;
    return sa < sb ? -1 : 1;
  }

  function simpleMarkdownToHtml(md) {
    return md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function uniqueQueryNames(widgets) {
    var s = new Set();
    for (var i = 0; i < widgets.length; i++) {
      if (widgets[i].query) s.add(widgets[i].query);
    }
    return Array.from(s);
  }

  /* Collect every query name the runtime needs to fetch / wire data for:
     widget.query (the existing path) **plus** any control's
     options_from.query so a dropdown populated from a query result still
     gets its source data even when no widget references the same query.
     Mirror of `collectDynamicOptionsQueryNames` in
     `src/lib/spar-dash-engine/dynamic-options.ts`. */
  function allManifestQueryNames(manifest) {
    var widgets = (manifest && manifest.widgets) || [];
    var controls = (manifest && manifest.controls) || [];
    var s = new Set();
    for (var i = 0; i < widgets.length; i++) {
      if (widgets[i] && widgets[i].query) s.add(widgets[i].query);
    }
    for (var j = 0; j < controls.length; j++) {
      var c = controls[j];
      if (c && c.options_from && typeof c.options_from.query === 'string') {
        var n = c.options_from.query.trim();
        if (n) s.add(n);
      }
    }
    return Array.from(s);
  }

  /* Magic date-default tokens resolved at runtime so `kind: "date"` controls
     can declare `default: "today"` / `"yesterday"` / `"start_of_month"` /
     `"start_of_week"` and stay fresh instead of shipping a frozen ISO
     string. Mirror of `resolveDateDefaultExpr` in
     `src/lib/spar-dash-engine/dynamic-defaults.ts` — keep both in sync.
     Resolution is UTC and type-gated (caller checks `ctrl.kind === "date"`):
     a token on a non-date control passes through as a literal string. */
  var DATE_DEFAULT_EXPR_VALUES = ['today', 'yesterday', 'start_of_month', 'start_of_week'];
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function formatIsoDateUtc(d) {
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function resolveDateDefaultExpr(expr, now) {
    if (typeof expr !== 'string') return null;
    if (DATE_DEFAULT_EXPR_VALUES.indexOf(expr) === -1) return null;
    var n = now || new Date();
    /* Snap to UTC midnight first — every supported token is a whole-day
       boundary so any time-of-day component from `now` is irrelevant. */
    var t = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
    if (expr === 'today') return formatIsoDateUtc(t);
    if (expr === 'yesterday') {
      var d1 = new Date(t);
      d1.setUTCDate(d1.getUTCDate() - 1);
      return formatIsoDateUtc(d1);
    }
    if (expr === 'start_of_month') {
      var d2 = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      return formatIsoDateUtc(d2);
    }
    if (expr === 'start_of_week') {
      /* ISO weeks anchor on Monday. `getUTCDay()` returns 0 (Sun)..6 (Sat);
         `(dow + 6) % 7` maps Mon=0..Sun=6 so subtracting lands on the most
         recent Monday inclusive (a Monday `now` stays put). */
      var dow = t.getUTCDay();
      var daysFromMonday = (dow + 6) % 7;
      var d3 = new Date(t);
      d3.setUTCDate(d3.getUTCDate() - daysFromMonday);
      return formatIsoDateUtc(d3);
    }
    return null;
  }

  /* Resolve a control's `options_from` source against fetched query rows.
     Mirror of `resolveDynamicOptions` in `src/lib/spar-dash-engine/dynamic-options.ts`
     — keep both in sync. Rules:
       - Walk rows, take distinct `row[field]` values (skip null/undefined).
       - Read `row[label_field || field]` for the display label.
       - Sort by value, asc by default (`source.sort: "desc"` for reverse).
       - If `include_all`, prepend `{ value: "all", label: "All" }`.
     Returns `[]` when `rows` hasn't arrived yet — the runtime re-renders
     the control once the source query lands (see refreshDynamicControls). */
  function resolveDynamicOptions(source, rows) {
    var out = [];
    var seen = Object.create(null);
    if (Array.isArray(rows)) {
      var field = source.field;
      var labelField = source.label_field || source.field;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!row || typeof row !== 'object') continue;
        var raw = row[field];
        if (raw === null || raw === undefined) continue;
        var value = String(raw);
        if (seen[value]) continue;
        seen[value] = 1;
        var labelRaw = row[labelField];
        var label =
          labelRaw === null || labelRaw === undefined ? value : String(labelRaw);
        out.push({ value: value, label: label });
      }
    }
    var dir = source.sort === 'desc' ? -1 : 1;
    out.sort(function (a, b) {
      if (a.value === b.value) return 0;
      return a.value < b.value ? -1 * dir : 1 * dir;
    });
    if (source.include_all) {
      out.unshift({ value: 'all', label: 'All' });
    }
    return out;
  }

  function widgetRows(widget, dataByQuery, applyTransformPipeline, paramState) {
    if (!widget.query) return [];
    var raw = dataByQuery[widget.query] || [];
    return applyTransformPipeline(raw, widget.transform, paramState);
  }

  function buildSearchParamsForQuery(qName, manifest, paramState) {
    var queries = manifest.queries || {};
    var qd;
    if (Array.isArray(queries)) {
      for (var qi = 0; qi < queries.length; qi++) {
        if (queries[qi] && queries[qi].name === qName) { qd = queries[qi]; break; }
      }
    } else {
      qd = queries[qName];
    }
    if (!qd || !qd.params) return '';
    var p = new URLSearchParams();
    for (var pk in qd.params) {
      var spec = qd.params[pk];
      var raw =
        paramState[pk] !== undefined && paramState[pk] !== ''
          ? String(paramState[pk])
          : spec.default !== undefined
            ? String(spec.default)
            : '';
      if (raw === '') continue;
      p.set(pk, raw);
    }
    return p.toString();
  }

  function getChartPalette(el) {
    if (!el) {
      return { fg: '#f0f0f6', muted: '#9496ae', border: '#2a2a3a', grid: '#1f1f2a', primary: '#8b5cf6' };
    }
    var s = getComputedStyle(el);
    function pick(name, fb) {
      var v = s.getPropertyValue(name).trim();
      return v || fb;
    }
    return {
      fg: pick('--spar-foreground', '#f0f0f6'),
      muted: pick('--spar-muted', '#9496ae'),
      border: pick('--spar-border', '#2a2a3a'),
      grid: pick('--spar-border-subtle', '#1f1f2a'),
      primary: pick('--spar-primary', '#8b5cf6'),
    };
  }

  function buildChartConfiguration(widget, rows, rootEl, paramState) {
    var enc = widget.encoding || {};
    var colors = getChartPalette(rootEl);
    var primary = colors.primary;
    var palette = [
      primary + 'cc',
      colors.muted + 'cc',
      '#34d399cc',
      '#fbbf24cc',
      '#60a5facc',
      '#f472b6cc',
    ];

    if (widget.type === 'pie') {
      var lf = enc.label || '';
      var vf = enc.value || '';
      var labels = rows.map(function (r) {
        return autoFormatValue(r[lf] ?? '');
      });
      var data = rows.map(function (r) {
        return Number(r[vf]) || 0;
      });
      return {
        type: 'pie',
        data: {
          labels: labels,
          datasets: [
            {
              data: data,
              backgroundColor: labels.map(function (_, i) {
                return palette[i % palette.length];
              }),
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: colors.muted } } },
        },
      };
    }

    var xf =
      resolveEffectiveFieldName(enc.x_field_from_param, enc.x, paramState) ||
      (typeof enc.x === 'string' ? enc.x : '');
    var labels = rows.map(function (r) {
      return autoFormatValue(r[xf] ?? '');
    });

    if (
      widget.type === 'line_multi' ||
      widget.type === 'stacked_area' ||
      widget.type === 'stacked_area_pct'
    ) {
      var rawYFields =
        enc.y_fields ||
        (typeof enc.y === 'string' ? [enc.y] : Array.isArray(enc.y) ? enc.y : []);
      var yFieldsFfp = enc.y_fields_field_from_param;
      var yFields = rawYFields.map(function (f, i) {
        var per =
          Array.isArray(yFieldsFfp) && yFieldsFfp[i] !== undefined
            ? yFieldsFfp[i]
            : i === 0
              ? enc.y_field_from_param
              : undefined;
        return (
          resolveEffectiveFieldName(per, typeof f === 'string' ? f : '', paramState) ||
          (typeof f === 'string' ? f : '')
        );
      });
      var stacked = widget.type !== 'line_multi';
      var pct = widget.type === 'stacked_area_pct';
      var datasets = yFields.map(function (field, i) {
        return {
          label: field,
          data: rows.map(function (r) {
            return Number(r[field]) || 0;
          }),
          borderColor: palette[i % palette.length],
          backgroundColor: stacked ? palette[i % palette.length].replace('cc', '66') : undefined,
          fill: stacked ? 'origin' : false,
          tension: 0.25,
          stack: stacked ? 'a' : undefined,
        };
      });
      var yScale = {
        stacked: stacked,
        min: pct ? 0 : undefined,
        max: pct ? 100 : undefined,
        ticks: { color: colors.muted },
        grid: { color: colors.grid },
      };
      if (pct) {
        yScale.ticks.callback = function (v) {
          return v + '%';
        };
      }
      return {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { labels: { color: colors.muted } } },
          scales: {
            x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
            y: yScale,
          },
        },
      };
    }

    var seriesField =
      resolveEffectiveFieldName(enc.series_field_from_param, enc.series, paramState) ||
      (typeof enc.series === 'string' ? enc.series : '');
    var yField =
      resolveEffectiveFieldName(
        enc.y_field_from_param,
        typeof enc.y === 'string' ? enc.y : Array.isArray(enc.y) ? enc.y[0] : undefined,
        paramState,
      ) || (typeof enc.y === 'string' ? enc.y : Array.isArray(enc.y) ? enc.y[0] : '');

    if (seriesField && yField) {
      var xLabels = Array.from(
        new Set(
          rows.map(function (r) {
            return autoFormatValue(r[xf] ?? '');
          }),
        ),
      );
      var seriesNames = Array.from(
        new Set(
          rows.map(function (r) {
            return autoFormatValue(r[seriesField] ?? '');
          }),
        ),
      );
      var stackedBar = widget.type === 'stacked_bar';
      var datasets = seriesNames.map(function (sn, i) {
        return {
          label: sn,
          data: xLabels.map(function (lab) {
            var row = rows.find(function (r) {
              return (
                autoFormatValue(r[xf] ?? '') === lab &&
                autoFormatValue(r[seriesField] ?? '') === sn
              );
            });
            return row ? Number(row[yField]) || 0 : 0;
          }),
          backgroundColor: palette[i % palette.length],
        };
      });
      return {
        type: 'bar',
        data: { labels: xLabels, datasets: datasets },
        options: {
          indexAxis: widget.type === 'bar_h' ? 'y' : 'x',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: colors.muted } } },
          scales: {
            x: {
              stacked: stackedBar,
              ticks: { color: colors.muted },
              grid: { color: colors.grid },
            },
            y: {
              stacked: stackedBar,
              ticks: { color: colors.muted },
              grid: { color: colors.grid },
            },
          },
        },
      };
    }

    var values = rows.map(function (r) {
      return Number(r[yField]) || 0;
    });
    return {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{ label: yField, data: values, backgroundColor: primary + '99' }],
      },
      options: {
        indexAxis: widget.type === 'bar_h' ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.muted }, grid: { color: colors.grid } },
        },
      },
    };
  }

  function findWidget(manifest, id) {
    for (var i = 0; i < manifest.widgets.length; i++) {
      if (manifest.widgets[i].id === id) return manifest.widgets[i];
    }
    return null;
  }

  function layoutStyle(slot) {
    /* `height` is set explicitly (in addition to `gridRow: span N` over a
       `grid-auto-rows: 58px` track) so the section has a *definite* height
       even if the parent flex chain breaks somewhere above (e.g. an embedder
       that doesn't make the mount node a flex container). AG Grid's
       `height: 100%` requires a definite parent height to enable internal
       scroll — without it, AG Grid silently degrades and the whole page
       scrolls instead of the table. `min-height: 0` cancels the default
       `min-height: auto` on grid items so content overflow can't push the
       cell taller than the allocation. */
    return {
      gridColumn: slot.x + 1 + ' / span ' + slot.w,
      gridRow: slot.y + 1 + ' / span ' + slot.h,
      height: slot.h * 58 + 'px',
      minHeight: 0,
    };
  }

  function renderWidgetBody(
    widget,
    rows,
    state,
    applyTransformPipeline,
    Chart,
    agGrid,
  ) {
    var wrap = document.createElement('div');
    wrap.className = 'spar-eng-widget-wrap';

    if (widget.type === 'markdown' && widget.content) {
      var md = document.createElement('div');
      md.className = 'spar-eng-md';
      md.innerHTML = simpleMarkdownToHtml(widget.content);
      wrap.appendChild(md);
      return wrap;
    }

    if (widget.type === 'kpi') {
      var v;
      var agg = widget.agg || widget.aggregate || widget.expression || 'count';
      var kpiField = resolveEffectiveFieldName(widget.field_from_param, widget.field || '', state.paramState);
      if (agg === 'count') {
        v = rows.length;
      } else if (agg === 'distinct_count' || agg === 'distinct' || agg === 'count_distinct') {
        var seen = {};
        var dc = 0;
        for (var ki = 0; ki < rows.length; ki++) {
          var kv = String(rows[ki][kpiField] ?? '');
          if (!seen[kv]) { seen[kv] = true; dc++; }
        }
        v = dc;
      } else if (agg === 'sum') {
        v = 0;
        for (var ki = 0; ki < rows.length; ki++) v += Number(rows[ki][kpiField]) || 0;
      } else if (agg === 'avg' || agg === 'average') {
        var total = 0;
        for (var ki = 0; ki < rows.length; ki++) total += Number(rows[ki][kpiField]) || 0;
        v = rows.length ? total / rows.length : 0;
      } else if (agg === 'min') {
        v = undefined;
        for (var ki = 0; ki < rows.length; ki++) {
          var rv = rows[ki][kpiField];
          if (rv === null || rv === undefined) continue;
          var nv = Number(rv);
          if (!isNaN(nv)) { if (v === undefined || nv < v) v = nv; }
          else { var sv = String(rv); if (v === undefined || sv < String(v)) v = sv; }
        }
      } else if (agg === 'max') {
        v = undefined;
        for (var ki = 0; ki < rows.length; ki++) {
          var rv = rows[ki][kpiField];
          if (rv === null || rv === undefined) continue;
          var nv = Number(rv);
          if (!isNaN(nv)) { if (v === undefined || nv > v) v = nv; }
          else { var sv = String(rv); if (v === undefined || sv > String(v)) v = sv; }
        }
      } else {
        /* Unrecognized agg — fall back to count rather than showing raw cell value */
        v = rows.length;
      }
      var formatted = formatWidgetField(widget, 'value', v, state.paramState);
      var tone =
        widget.tone === 'positive'
          ? 'var(--spar-success)'
          : widget.tone === 'negative'
            ? 'var(--spar-error)'
            : '';
      var inner = document.createElement('div');
      inner.className = 'spar-eng-kpi-inner';
      /* For KPIs we suppress the section-header bar (see renderWidgetsInto)
         and render `widget.title` as the in-body label. `widget.subtitle`
         (when present) renders as a small muted line under the value. */
      var labelText = widget.title || widget.label || '';
      if (labelText) {
        var lbl = document.createElement('span');
        lbl.className = 'spar-kpi-label';
        lbl.textContent = labelText;
        inner.appendChild(lbl);
      }
      var val = document.createElement('span');
      val.className = 'spar-kpi-value';
      if (tone) val.style.color = tone;
      if (formatted.indexOf('<span class="spar-rag-dot"') !== -1) val.innerHTML = formatted;
      else val.textContent = formatted;
      inner.appendChild(val);
      if (widget.subtitle) {
        var sub = document.createElement('span');
        sub.className = 'spar-muted';
        sub.className += ' spar-eng-kpi-sub';
        sub.textContent = widget.subtitle;
        inner.appendChild(sub);
      }
      wrap.appendChild(inner);
      return wrap;
    }

    if (widget.type === 'table' && widget.columns && widget.columns.length) {
      /* Use only the columns explicitly declared in the manifest.
         The manifest is the source of truth for which columns appear. */
      var effectiveColumns = widget.columns.slice();
      var host = document.createElement('div');
      host.className = 'ag-theme-quartz';
      /* No `min-height` — AG Grid fills the body wrap (which is bounded by
         the grid track allocation) and scrolls internally when the row count
         exceeds the visible area. */
      host.className += ' spar-eng-table-host';
      wrap.appendChild(host);
      queueMicrotask(function () {
        var colCount = effectiveColumns.length;
        var colDefs = effectiveColumns.map(function (c) {
          var dataField = resolveEffectiveFieldName(c.field_from_param, c.field, state.paramState);
          var base = {
            colId: c.field,
            field: dataField,
            headerName: c.label,
            minWidth: 100,
            headerClass: 'spar-ag-header-full',
            wrapHeaderText: true,
            autoHeaderHeight: true,
          };
          if (colCount <= 6) {
            base.flex = 1;
          }
          if (c.align === 'right') {
            base.cellClass = 'ag-right-aligned-cell';
            base.headerClass = 'ag-right-aligned-header';
          }
          var effFmt = resolveEffectiveFormatName(c.format_from_param, c.format, state.paramState);
          if (effFmt === 'rag_dot') {
            base.cellRenderer = function (p) {
              var span = document.createElement('span');
              span.innerHTML = formatByName('rag_dot', p.value);
              return span;
            };
          } else {
            base.valueFormatter = function (p) {
              return formatByName(effFmt, p.value);
            };
          }
          return base;
        });
        /* Bail if the body host was already replaced (e.g., a fast-arriving
           second progressive update for this widget). Without this we'd
           construct an AG Grid on a detached host and leak its handle. */
        if (!wrap.isConnected) return;
        agGrid.createGrid(host, {
          columnDefs: colDefs,
          rowData: rows,
          /* Default `domLayout: 'normal'` — AG Grid treats the host's height
             as a fixed viewport and scrolls internally. The previous
             `'autoHeight'` made the grid grow to fit *every* row, which
             pushed the section past its grid-track allocation and forced
             the whole page to scroll instead of the table itself. */
          defaultColDef: {
            sortable: true,
            resizable: true,
            filter: true,
            minWidth: 100,
            wrapHeaderText: true,
            autoHeaderHeight: true,
            /* Auto-detect numeric vs string per cell pair so SQL Decimal
               columns serialised as strings (e.g. "117.92", "9,931,271")
               sort numerically instead of lexicographically. Pure-string
               columns fall through to lex compare. */
            comparator: smartCellComparator,
          },
          headerHeight: 38,
          suppressColumnVirtualisation: true,
          animateRows: true,
          onGridReady: function (e) {
            state.gridByWidget[widget.id] = {
              destroy: function () { e.api.destroy(); },
            };
            /* CSV export via right-click. AG Grid v31 Community has no
               built-in context menu (that's Enterprise) but `exportDataAsCsv`
               IS available — so we suppress the browser default menu on the
               grid host and trigger the download immediately. Filename comes
               from the widget title for friendlier downloads. */
            host.addEventListener('contextmenu', function (ev) {
              ev.preventDefault();
              try {
                e.api.exportDataAsCsv({
                  fileName: (widget.title || widget.id || 'export') + '.csv',
                });
              } catch (exErr) {}
            });
            setTimeout(function () {
              try {
                e.api.autoSizeAllColumns();
                /* If total column width is LESS than the grid, stretch to
                   fill; otherwise keep auto-sized widths and let AG Grid
                   scroll horizontally — this prevents header truncation
                   on wide tables with many columns. */
                var gridWidth = host.clientWidth || 0;
                var totalColWidth = 0;
                var allCols = e.api.getColumns ? e.api.getColumns() : (e.columnApi ? e.columnApi.getAllColumns() : []);
                if (allCols && allCols.length) {
                  allCols.forEach(function (c) { totalColWidth += (c.getActualWidth ? c.getActualWidth() : 100); });
                  if (totalColWidth < gridWidth && gridWidth > 0) {
                    e.api.sizeColumnsToFit();
                  }
                }
              } catch (ex) {}
            }, 100);
          },
        });
      });
      return wrap;
    }

    if (CHART_TYPES[widget.type]) {
      var chartRoot = document.createElement('div');
      chartRoot.className = 'spar-eng-chart-root';
      var canvas = document.createElement('canvas');
      canvas.className = 'spar-eng-chart-canvas';
      chartRoot.appendChild(canvas);
      wrap.appendChild(chartRoot);
      queueMicrotask(function () {
        if (!rows.length && widget.type !== 'pie') return;
        /* Bail if the body host was already replaced (e.g., a fast-arriving
           second progressive update for this widget). Without this we'd
           construct a Chart.js instance on a detached canvas and leak it. */
        if (!wrap.isConnected) return;
        var cfg = buildChartConfiguration(widget, rows, chartRoot, state.paramState);
        var ch = new Chart(canvas, cfg);
        state.chartByWidget[widget.id] = ch;
      });
      return wrap;
    }

    var unsup = document.createElement('div');
    unsup.className = 'spar-muted';
    unsup.className += ' spar-eng-unsup';
    unsup.textContent = 'Unsupported widget type: ' + widget.type;
    wrap.appendChild(unsup);
    return wrap;
  }

  /* ── Data-fetch error card ─────────────────────────────────────────────
     Rendered when the initial `Promise.all(/api/data/...)` boot fetch
     fails. Replaces what used to be a single-line red `<p>` collapse with
     a structured diagnostic block: failed query name, endpoint URL,
     Athena error message + (line:col) when parseable, bound params, and
     a collapsible SQL viewer.

     Pulls structured data from `err.sparDebug.payload` (attached by the
     boot script's `fetchQuery` wrapper) — present only when the server
     populated it (preview-token / cookie / admin caller). For non-author
     callers `payload` carries just `{ error }` and the card degrades to
     the minimal "title + message" layout. */
  function buildDataErrorCard(err) {
    var msg = (err && err.message) ? err.message : String(err);
    var dbg = err && err.sparDebug ? err.sparDebug : null;
    var payload = (dbg && dbg.payload) || null;

    var root = document.createElement('div');
    root.className = 'spar-data-error';

    var title = document.createElement('div');
    title.className = 'spar-data-error__title';
    title.textContent = 'Failed to load data';
    root.appendChild(title);

    var msgEl = document.createElement('pre');
    msgEl.className = 'spar-data-error__msg';
    msgEl.textContent = msg;
    root.appendChild(msgEl);

    var meta = document.createElement('dl');
    meta.className = 'spar-data-error__meta';
    function addMetaRow(label, valueEl) {
      var dt = document.createElement('dt');
      dt.textContent = label;
      var dd = document.createElement('dd');
      dd.appendChild(valueEl);
      meta.appendChild(dt);
      meta.appendChild(dd);
    }
    function asCode(text) {
      var c = document.createElement('code');
      c.textContent = text;
      return c;
    }
    if (payload && payload.query_name) addMetaRow('Query', asCode(payload.query_name));
    var endpoint = (payload && payload.endpoint) || (dbg && dbg.url) || null;
    if (endpoint) addMetaRow('Endpoint', asCode(endpoint));
    if (payload && payload.error_location) {
      addMetaRow(
        'Location',
        asCode('line ' + payload.error_location.line + ':' + payload.error_location.column),
      );
    }
    if (payload && payload.params_bound && Object.keys(payload.params_bound).length > 0) {
      var paramsPre = document.createElement('pre');
      paramsPre.textContent = JSON.stringify(payload.params_bound, null, 2);
      addMetaRow('Params', paramsPre);
    }
    if (meta.children.length > 0) root.appendChild(meta);

    if (payload && typeof payload.sql === 'string' && payload.sql.length > 0) {
      var details = document.createElement('details');
      details.className = 'spar-data-error__sql';
      var summary = document.createElement('summary');
      summary.textContent = 'Show SQL (' + payload.sql.length + ' chars)';
      details.appendChild(summary);
      var sqlPre = document.createElement('pre');
      sqlPre.textContent = payload.sql;
      details.appendChild(sqlPre);
      root.appendChild(details);
    }

    return root;
  }

  /* Per-widget error body — rendered inline INSIDE a widget section when
     `renderWidgetBody` throws, so the rest of the dashboard keeps rendering.
     Names the widget id + type so the author can find the offending entry
     in the manifest without expanding a minified stack trace. The thrown
     error message is the leaf; in dev the full stack is on the console. */
  function buildWidgetErrorBody(widget, err) {
    var body = document.createElement('div');
    body.className = 'spar-widget-error';
    var head = document.createElement('div');
    head.className = 'spar-widget-error__head';
    head.textContent = 'Widget render error';
    body.appendChild(head);
    var meta = document.createElement('div');
    meta.className = 'spar-widget-error__meta';
    meta.textContent =
      (widget && widget.id ? widget.id : '?') +
      ' · ' +
      (widget && widget.type ? widget.type : 'unknown');
    body.appendChild(meta);
    var msg = document.createElement('pre');
    msg.className = 'spar-widget-error__msg';
    msg.textContent = err && err.message ? err.message : String(err);
    body.appendChild(msg);
    return body;
  }

  /**
   * @param {object} manifest - dashboard.manifest.v1
   * @param {{ mode: 'preview'|'live', data?: object, fetch?: (queryName: string, queryString: string) => Promise<{rows: object[]}>, mount?: Element|string, dashboardKey?: string }} options
   * @description In live mode, `fetch(queryName, queryString)` is called once per query on boot and again on every control change. The engine builds `queryString` from `manifest.queries[].params` + current control state via `buildSearchParamsForQuery`; the caller appends it to the data URL.
   */
  function render(manifest, options) {
    if (!global.SparDashTransform || typeof global.SparDashTransform.applyTransformPipeline !== 'function') {
      console.error('[SPAR] Load spar-dash-transform.js before spar-dash-render.js');
      return;
    }
    if (!global.Chart) {
      console.error('[SPAR] Chart.js not loaded');
      return;
    }
    if (!global.agGrid || typeof global.agGrid.createGrid !== 'function') {
      console.error('[SPAR] ag-grid-community not loaded');
      return;
    }

    var opts = options || {};
    var mode = opts.mode || 'preview';
    var mount =
      opts.mount && typeof opts.mount !== 'string'
        ? opts.mount
        : typeof opts.mount === 'string'
          ? document.querySelector(opts.mount)
          : document.getElementById('spar-dashboard-mount') || document.body;

    var applyTransformPipeline = global.SparDashTransform.applyTransformPipeline;
    var Chart = global.Chart;
    var agGrid = global.agGrid;

    var state = {
      /* Chart.js / AG Grid instances keyed by widget id rather than a flat
         array so a single query's progressive update can destroy + rebuild
         JUST the widgets bound to that query, leaving siblings untouched
         (their Chart.js animations and AG Grid scroll/sort/selection state
         survive). Reset wholesale by `destroyChartsAndGrids` on tab change
         / full rebuild; per-widget destroy uses `destroyChartGridForWidget`. */
      chartByWidget: {},
      gridByWidget: {},
      /* widget id -> the inner <div> that holds the widget's body content
         (Loading placeholder, error tile, chart canvas, AG Grid host, KPI
         block, or markdown). Populated by `renderWidgetsInto` once per
         widget section. Per-query progressive updates wipe + repopulate
         JUST these hosts via `replaceWidgetBody`, so the surrounding
         section chrome (header bar, layout slot, borders) is never
         touched and the grid never reflows. */
      widgetBodyHosts: {},
      root: null,
      paramState: {},
      widgetsHost: null,
      /* control.id -> function(): void. Populated by buildControlElement
         for `select` / `multiselect` controls that use `options_from`. The
         engine calls every refresher after a live-mode data fetch lands
         (and once per buildDom in preview mode) so dynamic dropdowns
         repopulate without rebuilding the whole controls bar — preserves
         popover state, user-typed text in adjacent text controls, and
         tab/scroll position. Map is reset on every buildDom call. */
      controlRefreshers: {},
      /* Per-query progressive-render state.
         - `loadedQueries[q] = 1` once that query's `/api/data` round-trip has
           SETTLED (success OR failure) at least once. Used by
           `renderWidgetsInto` to flip a widget OUT of the "Loading…"
           placeholder as soon as its source query lands — even while sibling
           queries are still in flight. Survives across reloads so a control
           change shows stale-while-revalidating instead of flashing every
           widget back to "Loading…".
         - `queryErrors[q]` holds the most recent fetch / parse error for
           query `q` (or `null` after a subsequent success). Widgets bound
           to a query with a non-null error render `buildWidgetErrorBody`
           in their tile so partial failures stay scoped — `mount.innerHTML`
           is NEVER wiped for a fetch error any more (which was the loop
           fuel before). */
      loadedQueries: {},
      queryErrors: {},
    };
    var lastDataByQuery = {};
    var activeTabId = manifest.tabs[0] ? manifest.tabs[0].id : 'main';

    /* Schedules a widgets-only re-render on the next animation frame so multiple
       rapid control changes (e.g. typing in a text input) coalesce into one
       paint. We rebuild only the widgets grid — the controls bar (and any open
       multiselect popover) is left intact so the user can keep interacting.
       In **live mode**, control changes additionally re-fetch all queries so
       server-side `:param` binds re-bind with the new values (matches the React
       runtime's behavior; see `state.reloadLiveData`). */
    var rerenderScheduled = false;
    function scheduleRerender() {
      if (rerenderScheduled) return;
      rerenderScheduled = true;
      (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function (fn) { setTimeout(fn, 16); })(function () {
        rerenderScheduled = false;
        if (state.mode === 'live' && typeof state.reloadLiveData === 'function') {
          state.reloadLiveData();
          return;
        }
        if (state.widgetsHost && state.widgetsHost.isConnected) {
          renderWidgetsInto(state.widgetsHost, lastDataByQuery);
        } else {
          buildDom(lastDataByQuery);
        }
      });
    }

    /* Walk every registered control refresher and let it re-resolve its
       `options_from` against the latest `lastDataByQuery`. Called after a
       live-mode data fetch lands (boot + every control change), and after
       the preview-mode dataByQuery is wired in `buildDom`. The refreshers
       update existing DOM nodes in place — they do NOT rebuild the
       controls bar — so popover state, scroll position, and focus survive
       each refresh. */
    function refreshDynamicControls() {
      var ids = Object.keys(state.controlRefreshers);
      for (var i = 0; i < ids.length; i++) {
        var fn = state.controlRefreshers[ids[i]];
        if (typeof fn === 'function') {
          try { fn(); } catch (e) { console.warn('[SPAR] control refresher failed:', e); }
        }
      }
    }

    function destroyChartsAndGrids() {
      Object.keys(state.chartByWidget).forEach(function (id) {
        try { state.chartByWidget[id].destroy(); } catch (e) {}
      });
      state.chartByWidget = {};
      Object.keys(state.gridByWidget).forEach(function (id) {
        try {
          var g = state.gridByWidget[id];
          if (g && typeof g.destroy === 'function') g.destroy();
        } catch (e2) {}
      });
      state.gridByWidget = {};
    }

    /* Destroy the Chart.js / AG Grid instance for a SINGLE widget (if it
       has one). Used by `replaceWidgetBody` so a per-query progressive
       update doesn't tear down sibling widgets' instances — which would
       reset their scroll position, sort order, and replay Chart.js
       animations even though their data hasn't changed. */
    function destroyChartGridForWidget(widgetId) {
      var c = state.chartByWidget[widgetId];
      if (c) {
        try { c.destroy(); } catch (e) {}
        delete state.chartByWidget[widgetId];
      }
      var g = state.gridByWidget[widgetId];
      if (g) {
        try { if (typeof g.destroy === 'function') g.destroy(); } catch (e2) {}
        delete state.gridByWidget[widgetId];
      }
    }

    /* Render the contents of a single widget's body host (loading
       placeholder, error tile, or real body) based on its CURRENT
       per-query state. The surrounding section, header bar, and grid
       layout are untouched — only `host.innerHTML` and the chart / grid
       instance for THIS widget get replaced. Used both for initial
       paint inside `renderWidgetsInto` and for per-query progressive
       updates via `updateWidgetsForQuery`. */
    function replaceWidgetBody(w, host) {
      destroyChartGridForWidget(w.id);
      host.innerHTML = '';
      var queryName = w.query;
      var queryErr = queryName ? state.queryErrors[queryName] : null;
      var isLoading = !!queryName && !state.loadedQueries[queryName];
      if (queryErr) {
        host.appendChild(buildWidgetErrorBody(w, queryErr));
        return;
      }
      if (isLoading) {
        var loadingBody = document.createElement('div');
        loadingBody.className = 'spar-widget-loading';
        loadingBody.className += ' spar-eng-loading-body';
        loadingBody.textContent = 'Loading\u2026';
        host.appendChild(loadingBody);
        return;
      }
      var rows = widgetRows(w, lastDataByQuery, applyTransformPipeline, state.paramState);
      /* Per-widget try/catch so a single broken widget (bad encoding,
         missing column in the row shape, malformed transform output) does
         NOT propagate up to the reloadLiveData .catch — which would wipe
         the entire mount and, combined with any control that schedules a
         rerender at init, kick off a render-error → mount-wipe → rebuild
         reload loop. Each broken widget shows an inline error card that
         names the widget id + type so the author can pinpoint the bad
         definition without re-binding devtools to a minified bundle. */
      try {
        var body = renderWidgetBody(w, rows, state, applyTransformPipeline, Chart, agGrid);
        host.appendChild(body);
      } catch (widgetErr) {
        console.error('[SPAR] widget render failed:', w.id, w.type, widgetErr);
        host.appendChild(buildWidgetErrorBody(w, widgetErr));
      }
    }

    function renderWidgetsInto(grid, dataByQuery) {
      destroyChartsAndGrids();
      state.widgetBodyHosts = {};
      grid.innerHTML = '';
      var tab = manifest.tabs.find(function (x) { return x.id === activeTabId; });
      var layout = (tab && tab.layout) || [];
      var widgetById = {};
      manifest.widgets.forEach(function (w) { widgetById[w.id] = w; });
      for (var i = 0; i < layout.length; i++) {
        (function(slot) {
        var w = widgetById[slot.widget];
        if (!w) return;
        var sec = document.createElement('section');
        /* Tables: drop `.spar-card` entirely — AG Grid renders its own
           outer border, background, and chrome, so any card chrome on the
           wrapper would just doubled-up against it. The rounded corners +
           `overflow: hidden` below still clip the AG Grid edge to the
           card radius, so the visual frame is preserved. */
        sec.className = w.type === 'table' ? '' : 'spar-card';
        Object.assign(sec.style, layoutStyle(slot));
        sec.style.display = 'flex';
        sec.style.flexDirection = 'column';
        sec.style.overflow = 'hidden';
        sec.style.padding = '0';
        sec.style.borderRadius = 'var(--spar-radius-sm, 6px)';
        /* KPI widgets render label + value as one cohesive body — no
           section-header bar with a border line, which looks heavy on
           tiny tiles. The KPI body itself includes the title as its
           top-line `.spar-kpi-label`. Tables / charts / markdown keep
           the section header so their content is visually anchored. */
        var isKpi = w.type === 'kpi';
        if (!isKpi && (w.type !== 'markdown' || w.title)) {
          var head = document.createElement('div');
          /* Flex row so a small action affordance (e.g. table CSV export)
             can sit on the right while the title/subtitle stack lives on
             the left. `align-items: flex-start` keeps the button glued to
             the top line even when a long subtitle wraps. */
          head.className = 'spar-eng-section-head';
          var titleWrap = document.createElement('div');
          titleWrap.className = 'spar-eng-title-wrap';
          var h2 = document.createElement('h2');
          h2.className = 'spar-eng-h2';
          h2.textContent = w.title || w.id;
          titleWrap.appendChild(h2);
          if (w.subtitle) {
            var ps = document.createElement('p');
            ps.className = 'spar-muted';
            ps.className += ' spar-eng-subtitle';
            ps.textContent = w.subtitle;
            titleWrap.appendChild(ps);
          }
          head.appendChild(titleWrap);
          sec.appendChild(head);
        }
        /* Stable body host: created once per widget here, then targeted
           by `updateWidgetsForQuery` on per-query progressive updates so
           we never destroy + recreate the surrounding `<section>`. */
        var bodyHost = document.createElement('div');
        bodyHost.className = 'spar-eng-widget-body';
        bodyHost.style.cssText = 'flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;';
        sec.appendChild(bodyHost);
        state.widgetBodyHosts[w.id] = bodyHost;
        replaceWidgetBody(w, bodyHost);
        grid.appendChild(sec);
        })(layout[i]);
      }
    }

    /* Per-query progressive update. Re-renders ONLY the widgets whose
       `w.query === queryName` (and refreshes any dynamic-options control
       sourced from that query). Sibling widgets bound to other queries —
       and any Chart.js animations / AG Grid scroll / sort / selection
       state they hold — are left completely untouched. Called by
       `reloadLiveData` once per query as each `/api/data/<q>` response
       lands.
    
       Falls back to a full `renderWidgetsInto` rebuild if the widget body
       host map is empty (e.g., the surrounding chrome was torn down by a
       tab change while a fetch was still in flight). */
    function updateWidgetsForQuery(queryName) {
      var hostMap = state.widgetBodyHosts;
      var haveHosts = hostMap && Object.keys(hostMap).length > 0;
      if (!haveHosts) {
        if (state.widgetsHost && state.widgetsHost.isConnected) {
          renderWidgetsInto(state.widgetsHost, lastDataByQuery);
          refreshDynamicControls();
        } else {
          buildDom(lastDataByQuery);
        }
        return;
      }
      manifest.widgets.forEach(function (w) {
        if (w.query !== queryName) return;
        var host = hostMap[w.id];
        if (!host || !host.isConnected) return;
        replaceWidgetBody(w, host);
      });
      /* Refresh any dynamic-options dropdown — they all read from
         `lastDataByQuery` and are cheap (just rebuild `<option>` children
         in place). Calling them per-query-landing keeps multiselect
         popovers / focused text inputs intact while still letting their
         options populate as their source query arrives. */
      refreshDynamicControls();
    }

    /* Resolve a control's effective options list — dynamic (options_from)
       reads the latest fetched rows from `lastDataByQuery`; static falls
       through to the manifest `options[]` array. Both shapes return
       `[{ value, label }]` so downstream code never branches on source. */
    function getControlOptions(ctrl) {
      if (ctrl && ctrl.options_from) {
        var rows =
          (lastDataByQuery && lastDataByQuery[ctrl.options_from.query]) || [];
        return resolveDynamicOptions(ctrl.options_from, rows);
      }
      return (ctrl && ctrl.options) || [];
    }

    /* ── Multiselect dropdown helper ──────────────────────────────────────────
       Renders a single-line trigger button (e.g. "All", "All (12)",
       "EURC, HYPE +1") that opens a popover with a checkbox per option plus
       Select all / Clear. Mirrors the React `MultiselectDropdown` so both
       renderers look and behave the same. Maintains comma-joined
       `paramState[ctrl.param]` semantics so `from_param` filters keep
       working unchanged. */
    function buildMultiselectDropdown(ctrl) {
      var wrap = document.createElement('div');
      wrap.style.position = 'relative';
      wrap.style.display = 'inline-block';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spar-control-input';
      btn.style.cursor = 'pointer';
      btn.style.textAlign = 'left';
      btn.style.minWidth = '140px';
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.justifyContent = 'space-between';
      btn.style.gap = '8px';
      var lblSpan = document.createElement('span');
      lblSpan.style.flex = '1';
      lblSpan.style.overflow = 'hidden';
      lblSpan.style.textOverflow = 'ellipsis';
      lblSpan.style.whiteSpace = 'nowrap';
      var chev = document.createElement('span');
      chev.textContent = '▾';
      chev.style.flex = '0 0 auto';
      chev.style.opacity = '0.6';
      chev.style.fontSize = '9px';
      btn.appendChild(lblSpan);
      btn.appendChild(chev);

      var pop = document.createElement('div');
      pop.style.display = 'none';
      pop.style.position = 'absolute';
      pop.style.top = 'calc(100% + 4px)';
      pop.style.left = '0';
      pop.style.zIndex = '1000';
      pop.style.minWidth = '180px';
      pop.style.maxHeight = '260px';
      pop.style.flexDirection = 'column';
      pop.style.overflow = 'hidden';
      pop.style.background = 'var(--spar-surface-elevated)';
      pop.style.border = '1px solid var(--spar-border)';
      pop.style.borderRadius = '6px';
      pop.style.boxShadow = '0 6px 24px rgba(0,0,0,0.28)';

      var topBar = document.createElement('div');
      topBar.style.display = 'flex';
      topBar.style.gap = '6px';
      topBar.style.padding = '6px 8px';
      topBar.style.borderBottom = '1px solid var(--spar-border-subtle)';
      var listWrap = document.createElement('div');
      listWrap.style.flex = '1';
      listWrap.style.overflowY = 'auto';
      listWrap.style.padding = '4px 0';
      pop.appendChild(topBar);
      pop.appendChild(listWrap);

      function makeSmallBtn(text, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.style.flex = '1';
        b.style.padding = '3px 6px';
        b.style.fontSize = '10px';
        b.style.borderRadius = '3px';
        b.style.border = '1px solid var(--spar-border)';
        b.style.background = 'transparent';
        b.style.color = 'var(--spar-muted)';
        b.style.cursor = 'pointer';
        b.onclick = function (ev) {
          ev.stopPropagation();
          onClick();
        };
        return b;
      }

      var selected = {};
      function seedFromState() {
        var seedRaw =
          ctrl.param && state.paramState[ctrl.param] != null
            ? state.paramState[ctrl.param]
            : ctrl.default;
        selected = {};
        if (seedRaw != null && seedRaw !== '') {
          String(seedRaw).split(',').forEach(function (s) {
            var t = s.trim();
            if (t) selected[t] = 1;
          });
        }
      }
      function normalizedOpts() {
        return getControlOptions(ctrl).map(function (o) {
          var v = typeof o === 'object' ? String(o.value || '') : String(o);
          var lbl = typeof o === 'object' ? (o.label || o.value || v) : String(o);
          return { value: v, label: lbl };
        });
      }
      function refreshLabel(opts) {
        var keys = Object.keys(selected);
        if (keys.length === 0) {
          lblSpan.textContent = 'All';
          btn.style.color = 'var(--spar-muted)';
          return;
        }
        btn.style.color = 'var(--spar-foreground)';
        if (keys.length === opts.length && opts.length > 0) {
          lblSpan.textContent = 'All (' + opts.length + ')';
          return;
        }
        var labels = opts
          .filter(function (o) { return !!selected[o.value]; })
          .map(function (o) { return o.label; });
        if (labels.length <= 2) {
          lblSpan.textContent = labels.join(', ');
        } else {
          lblSpan.textContent = labels.slice(0, 2).join(', ') + ' +' + (labels.length - 2);
        }
      }
      function commit() {
        if (!ctrl.param) return;
        state.paramState[ctrl.param] = Object.keys(selected).join(',');
        scheduleRerender();
      }
      function rebuildList() {
        var opts = normalizedOpts();
        listWrap.innerHTML = '';
        opts.forEach(function (o) {
          var row = document.createElement('label');
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.gap = '8px';
          row.style.padding = '4px 10px';
          row.style.fontSize = '11px';
          row.style.cursor = 'pointer';
          row.onmouseenter = function () {
            row.style.background = 'var(--spar-table-row-hover)';
          };
          row.onmouseleave = function () {
            row.style.background = 'transparent';
          };
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!selected[o.value];
          cb.style.accentColor = 'var(--spar-primary)';
          cb.onclick = function (ev) { ev.stopPropagation(); };
          cb.onchange = function () {
            if (cb.checked) selected[o.value] = 1;
            else delete selected[o.value];
            refreshLabel(opts);
            commit();
          };
          var txt = document.createElement('span');
          txt.textContent = o.label;
          row.appendChild(cb);
          row.appendChild(txt);
          listWrap.appendChild(row);
        });
        topBar.innerHTML = '';
        topBar.appendChild(makeSmallBtn('Select all', function () {
          opts.forEach(function (o) { selected[o.value] = 1; });
          rebuildList();
          commit();
        }));
        topBar.appendChild(makeSmallBtn('Clear', function () {
          selected = {};
          rebuildList();
          commit();
        }));
        refreshLabel(opts);
      }

      seedFromState();
      rebuildList();
      /* Sync paramState with the initial `selected` set WITHOUT calling
         commit() at init — commit() schedules a rerender, which in live mode
         re-fetches every /api/data query. The live-mode boot below (see
         `(manifest.controls || []).forEach`) already pre-seeds paramState
         from `ctrl.default`, so the scheduled fetch would be both redundant
         AND open the door to a runaway reload loop: if any widget's first
         render throws (e.g. an encoding referencing a field the SQL didn't
         return), the boot `.catch` wipes `mount.innerHTML` → widgetsHost
         disconnects → next reload's `.then` falls back to `buildDom` →
         buildMultiselectDropdown runs again → another scheduleRerender →
         another reload, forever (~80 Hz, matches a rAF cadence). Writing
         paramState directly here keeps the seed-from-default semantics
         (relevant in preview mode where `c.default` isn't pre-applied) and
         removes the rerender side-effect entirely. */
      if (ctrl.param) {
        state.paramState[ctrl.param] = Object.keys(selected).join(',');
      }

      function offClick(ev) {
        if (!wrap.contains(ev.target)) {
          pop.style.display = 'none';
          document.removeEventListener('click', offClick);
        }
      }
      btn.onclick = function (ev) {
        ev.stopPropagation();
        if (pop.style.display === 'flex') {
          pop.style.display = 'none';
          document.removeEventListener('click', offClick);
        } else {
          pop.style.display = 'flex';
          document.addEventListener('click', offClick);
        }
      };

      if (ctrl.options_from && ctrl.id) {
        state.controlRefreshers[ctrl.id] = function () {
          seedFromState();
          rebuildList();
        };
      }

      wrap.appendChild(btn);
      wrap.appendChild(pop);
      return wrap;
    }

    /* Build a single control as a horizontal `.spar-control` row: tiny
       uppercase label LEFT of the input. Buttons render as a stand-alone
       `.spar-btn` (with optional `--primary` variant when `ctrl.variant`
       is `"primary"`); toggles render as a checkbox + inline label.
       Styling lives in spar-dashboard-design-system.ts so the standalone
       and React renderers stay visually identical. */
    function buildControlElement(ctrl) {
      if (ctrl.kind === 'button') {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'spar-btn' + (ctrl.variant === 'primary' ? ' spar-btn--primary' : '');
        btn.textContent = ctrl.label || ctrl.id || 'Button';
        return btn;
      }
      if (ctrl.kind === 'toggle') {
        var tWrap = document.createElement('label');
        tWrap.className = 'spar-control';
        tWrap.style.cursor = 'pointer';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.style.accentColor = 'var(--spar-primary)';
        var tLbl = document.createElement('span');
        tLbl.className = 'spar-control-label';
        tLbl.style.letterSpacing = '0.04em';
        tLbl.textContent = ctrl.label || ctrl.id || 'Toggle';
        tWrap.appendChild(cb);
        tWrap.appendChild(tLbl);
        return tWrap;
      }
      if (ctrl.kind === 'tabs') {
        /* tabs rendered separately by buildDom */
        return document.createDocumentFragment();
      }

      var cWrap = document.createElement('div');
      cWrap.className = 'spar-control';
      if (ctrl.label) {
        var lbl = document.createElement('label');
        lbl.className = 'spar-control-label';
        lbl.textContent = ctrl.label;
        cWrap.appendChild(lbl);
      }
      if (ctrl.kind === 'select') {
        var sel = document.createElement('select');
        sel.className = 'spar-control-input';
        sel.style.cursor = 'pointer';
        sel.style.minWidth = '100px';
        /* Prefer the current paramState over `default` so a refresh
           preserves the user's selection across dynamic-options re-resolves
           (live mode boots paint the bar before /api/data lands, then
           re-renders options once the source query returns). */
        var currentSelValue =
          ctrl.param && state.paramState[ctrl.param] != null
            ? String(state.paramState[ctrl.param])
            : ctrl.default !== undefined
              ? String(ctrl.default)
              : '';
        function populateSelectOptions() {
          sel.innerHTML = '';
          var opts = getControlOptions(ctrl);
          opts.forEach(function (o) {
            var opt = document.createElement('option');
            opt.value = typeof o === 'object' ? (o.value || '') : String(o);
            opt.textContent = typeof o === 'object' ? (o.label || o.value || '') : String(o);
            if (currentSelValue !== '' && String(opt.value) === currentSelValue) {
              opt.selected = true;
            }
            sel.appendChild(opt);
          });
          /* If the previously-selected value no longer exists in the
             refreshed set, fall back to the first option (matches native
             `<select>` behavior on element rebuild). */
          var stillExists = opts.some(function (o) {
            var v = typeof o === 'object' ? String(o.value || '') : String(o);
            return v === currentSelValue;
          });
          if (!stillExists && opts.length > 0) {
            sel.value = typeof opts[0] === 'object' ? String(opts[0].value || '') : String(opts[0]);
            currentSelValue = String(sel.value || '');
          }
        }
        populateSelectOptions();
        if (ctrl.param) {
          /* Seed paramState only when the select actually has a value and
             paramState hasn't been initialized yet — otherwise an empty
             dynamic-options dropdown on initial live paint would clobber
             a perfectly good default (e.g. "all") with the empty string. */
          var initialSelValue = String(sel.value || '');
          if (initialSelValue !== '' || state.paramState[ctrl.param] == null) {
            state.paramState[ctrl.param] = initialSelValue;
          }
          sel.onchange = function () {
            currentSelValue = String(sel.value);
            state.paramState[ctrl.param] = currentSelValue;
            scheduleRerender();
          };
        }
        if (ctrl.options_from && ctrl.id) {
          state.controlRefreshers[ctrl.id] = function () {
            var prev = currentSelValue;
            populateSelectOptions();
            if (ctrl.param && sel.value !== prev) {
              state.paramState[ctrl.param] = String(sel.value || '');
            }
          };
        }
        cWrap.appendChild(sel);
      } else if (ctrl.kind === 'multiselect') {
        cWrap.appendChild(buildMultiselectDropdown(ctrl));
      } else if (ctrl.kind === 'date') {
        var inpD = document.createElement('input');
        inpD.type = 'date';
        inpD.className = 'spar-control-input';
        if (ctrl.default) {
          /* Resolve magic tokens (`today` / `yesterday` / `start_of_month` /
             `start_of_week`) to a real ISO date before assigning to
             `inpD.value` — `<input type="date">` silently rejects any
             non-ISO value and renders blank, which used to make a
             `default: "today"` look as if the manifest hadn't set a
             default at all. */
          var resolvedD = resolveDateDefaultExpr(ctrl.default);
          inpD.value = resolvedD !== null ? resolvedD : ctrl.default;
        }
        if (ctrl.param) {
          state.paramState[ctrl.param] = String(inpD.value || '');
          inpD.onchange = function () {
            state.paramState[ctrl.param] = String(inpD.value);
            scheduleRerender();
          };
        }
        cWrap.appendChild(inpD);
      } else if (ctrl.kind === 'text') {
        var inpT = document.createElement('input');
        inpT.type = 'text';
        inpT.className = 'spar-control-input';
        if (ctrl.default != null) inpT.value = String(ctrl.default);
        if (ctrl.placeholder) inpT.placeholder = ctrl.placeholder;
        if (ctrl.param) {
          state.paramState[ctrl.param] = String(inpT.value || '');
          inpT.oninput = function () {
            state.paramState[ctrl.param] = String(inpT.value);
            scheduleRerender();
          };
        }
        cWrap.appendChild(inpT);
      } else if (ctrl.kind === 'slider') {
        var inpR = document.createElement('input');
        inpR.type = 'range';
        inpR.style.accentColor = 'var(--spar-primary)';
        if (ctrl.min !== undefined) inpR.min = ctrl.min;
        if (ctrl.max !== undefined) inpR.max = ctrl.max;
        if (ctrl.default !== undefined) inpR.value = ctrl.default;
        if (ctrl.param) {
          state.paramState[ctrl.param] = String(inpR.value || '');
          inpR.oninput = function () {
            state.paramState[ctrl.param] = String(inpR.value);
            scheduleRerender();
          };
        }
        cWrap.appendChild(inpR);
      } else {
        var fallback = document.createElement('span');
        fallback.className = 'spar-muted';
        fallback.style.fontSize = '10px';
        fallback.textContent = '[' + (ctrl.kind || 'unknown') + ']';
        cWrap.appendChild(fallback);
      }
      return cWrap;
    }

    function buildDom(dataByQuery) {
      lastDataByQuery = dataByQuery;
      destroyChartsAndGrids();
      state.widgetsHost = null;
      /* Each buildDom call re-creates control elements from scratch, so the
         per-control refreshers from the previous DOM are stale references
         — drop them before buildControlElement re-registers fresh ones. */
      state.controlRefreshers = {};
      mount.innerHTML = '';


      /* Inner mount uses `spar-manifest-dash` only; the `spar-dash` + theme
         class (`spar-dash--dark`/`spar-dash--light`) live on the host body and
         are toggled by the parent SPAR theme bridge. CSS vars cascade in. */
      var root = document.createElement('div');
      root.className = 'spar-manifest-dash';
      root.className += ' spar-eng-root';
      state.root = root;

      var main = document.createElement('main');
      main.className = 'spar-shell';
      main.className += ' spar-eng-main';

      /* Hero — eyebrow row (badge + system text) above the bold title and an
         optional muted byline. Uses semantic classes from the design system
         so the standalone and React renderers stay visually identical. */
      var header = document.createElement('header');
      header.className = 'spar-hero';

      var dash = manifest.dashboard || {};
      if (dash.badge || dash.system || mode === 'preview') {
        var eyebrow = document.createElement('div');
        eyebrow.className = 'spar-eyebrow';
        if (dash.badge) {
          var badgeChip = document.createElement('span');
          badgeChip.className = 'spar-badge';
          badgeChip.textContent = String(dash.badge);
          eyebrow.appendChild(badgeChip);
        }
        if (dash.system) {
          var sysText = document.createElement('span');
          sysText.textContent = String(dash.system);
          eyebrow.appendChild(sysText);
        }
        if (mode === 'preview') {
          var prevPill = document.createElement('span');
          prevPill.className = 'spar-muted';
          prevPill.style.fontSize = '10.5px';
          prevPill.textContent = dash.badge || dash.system ? '· standalone preview' : 'Standalone preview · cached data';
          eyebrow.appendChild(prevPill);
        }
        header.appendChild(eyebrow);
      }

      var h1 = document.createElement('h1');
      h1.style.display = 'flex';
      h1.style.flexWrap = 'wrap';
      h1.style.alignItems = 'baseline';
      h1.style.gap = '10px';
      var titleText = document.createElement('span');
      titleText.textContent = dash.title || dash.key || 'Dashboard';
      h1.appendChild(titleText);
      if (
        typeof dash.preview_version === 'number' &&
        isFinite(dash.preview_version)
      ) {
        var vBadge = document.createElement('span');
        vBadge.className = 'spar-badge';
        vBadge.textContent = 'v' + dash.preview_version;
        h1.appendChild(vBadge);
      }
      header.appendChild(h1);
      if (dash.byline || dash.subtitle) {
        var byline = document.createElement('p');
        byline.className = 'spar-hero-byline';
        byline.textContent = String(dash.byline || dash.subtitle);
        header.appendChild(byline);
      }
      main.appendChild(header);

      var controls = manifest.controls || [];
      if (controls.length > 0) {
        /* Split controls into groups: "top" (default) and "filters" */
        var topControls = [];
        var filterControls = [];
        controls.forEach(function (ctrl) {
          if (ctrl.kind === 'tabs') return;
          if (ctrl.group === 'filters') {
            filterControls.push(ctrl);
          } else {
            topControls.push(ctrl);
          }
        });
        if (topControls.length > 0) {
          var bar = document.createElement('div');
          bar.className = 'spar-controls-bar';
          topControls.forEach(function (ctrl) {
            bar.appendChild(buildControlElement(ctrl));
          });
          main.appendChild(bar);
        }
        if (filterControls.length > 0) {
          var bar2 = document.createElement('div');
          bar2.className = 'spar-controls-bar';
          bar2.style.cssText += 'display:flex;align-items:center;flex-wrap:wrap;';
          /* Separate left-aligned and right-aligned filter controls */
          var leftFilters = [];
          var rightFilters = [];
          filterControls.forEach(function (ctrl) {
            if (ctrl.style === 'right') {
              rightFilters.push(ctrl);
            } else {
              leftFilters.push(ctrl);
            }
          });
          leftFilters.forEach(function (ctrl) {
            bar2.appendChild(buildControlElement(ctrl));
          });
          if (rightFilters.length > 0) {
            var spacer = document.createElement('div');
            spacer.className = 'spar-eng-spacer';
            bar2.appendChild(spacer);
            rightFilters.forEach(function (ctrl) {
              bar2.appendChild(buildControlElement(ctrl));
            });
          }
          main.appendChild(bar2);
        }
        /* Fallback: if no grouping was used, render all in one bar */
        if (topControls.length === 0 && filterControls.length === 0) {
          var barFallback = document.createElement('div');
          barFallback.className = 'spar-controls-bar';
          controls.forEach(function (ctrl) {
            if (ctrl.kind === 'tabs') return;
            barFallback.appendChild(buildControlElement(ctrl));
          });
          main.appendChild(barFallback);
        }
      }

      var tabBar = null;
      if (manifest.tabs.length > 1) {
        tabBar = document.createElement('div');
        tabBar.className = 'spar-tab-bar';
        manifest.tabs.forEach(function (t) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'spar-tab' + (t.id === activeTabId ? ' spar-tab--active' : '');
          b.textContent = t.label;
          b.onclick = function () {
            activeTabId = t.id;
            buildDom(lastDataByQuery);
          };
          tabBar.appendChild(b);
        });
        main.appendChild(tabBar);
      }

      var tab = manifest.tabs.find(function (x) {
        return x.id === activeTabId;
      });
      var layout = (tab && tab.layout) || [];

      var grid = document.createElement('div');
      grid.className = 'spar-eng-grid';
      state.widgetsHost = grid;
      renderWidgetsInto(grid, dataByQuery);

      main.appendChild(grid);
      root.appendChild(main);
      mount.appendChild(root);
    }


    if (mode === 'preview') {
      var data = opts.data || {};
      var dataByQuery = {};
      /* Build a case-insensitive lookup map for preview_data keys */
      var dataKeysLower = {};
      Object.keys(data).forEach(function (k) { dataKeysLower[k.toLowerCase()] = k; });
      /* `allManifestQueryNames` includes both widget queries and any
         control's `options_from.query`, so a dropdown populated from a
         query result gets its preview rows wired even if no widget on the
         active tab references the same query. */
      allManifestQueryNames(manifest).forEach(function (q) {
        var entry = data[q] || data[dataKeysLower[q.toLowerCase()] || ''];
        if (entry) {
          /* Support both { rows: [...] } and bare array */
          dataByQuery[q] = Array.isArray(entry) ? entry : (entry.rows || []);
        } else {
          dataByQuery[q] = [];
        }
      });
      /* If any queries are still empty, try harder to wire preview data */
      var queryNames = allManifestQueryNames(manifest);
      var dataKeys = Object.keys(data);
      if (queryNames.length > 0 && dataKeys.length > 0) {
        /* Collect all available row arrays from data */
        var allAvailableRows = {};
        dataKeys.forEach(function (k) {
          var entry = data[k];
          var rows = Array.isArray(entry) ? entry : (entry && entry.rows ? entry.rows : []);
          if (rows.length > 0) allAvailableRows[k] = rows;
        });
        var availKeys = Object.keys(allAvailableRows);

        queryNames.forEach(function (q) {
          if (dataByQuery[q] && dataByQuery[q].length > 0) return; /* already wired */
          /* Try exact match (already done above), then normalized match */
          var norm = q.toLowerCase().replace(/[-_\s]/g, '');
          for (var ai = 0; ai < availKeys.length; ai++) {
            var ak = availKeys[ai];
            var akNorm = ak.toLowerCase().replace(/[-_\s]/g, '');
            if (akNorm === norm) { dataByQuery[q] = allAvailableRows[ak]; return; }
          }
          /* If only one data source available, wire it to any empty query */
          if (availKeys.length === 1) {
            dataByQuery[q] = allAvailableRows[availKeys[0]];
          }
          /* If still empty and multiple keys, wire the largest dataset */
          if ((!dataByQuery[q] || dataByQuery[q].length === 0) && availKeys.length > 1) {
            var bestKey = availKeys[0];
            var bestLen = allAvailableRows[bestKey].length;
            for (var bi = 1; bi < availKeys.length; bi++) {
              if (allAvailableRows[availKeys[bi]].length > bestLen) {
                bestKey = availKeys[bi];
                bestLen = allAvailableRows[bestKey].length;
              }
            }
            dataByQuery[q] = allAvailableRows[bestKey];
          }
          /* Last resort: try partial/substring match */
          if ((!dataByQuery[q] || dataByQuery[q].length === 0)) {
            for (var pi = 0; pi < availKeys.length; pi++) {
              var pk = availKeys[pi];
              var pkNorm = pk.toLowerCase().replace(/[-_\s]/g, '');
              if (norm.indexOf(pkNorm) !== -1 || pkNorm.indexOf(norm) !== -1) {
                dataByQuery[q] = allAvailableRows[pk];
                break;
              }
            }
          }
        });
      }
      /* Preview mode has all rows up front — mark every query as "loaded"
         so `renderWidgetsInto`'s per-widget Loading…/error/data branch
         takes the data path (without this, widgets would stay stuck on
         "Loading…" forever because `state.loadedQueries` is empty in
         preview). */
      Object.keys(dataByQuery).forEach(function (q) {
        state.loadedQueries[q] = 1;
      });
      buildDom(dataByQuery);
      return;
    }

    var dashboardKey = opts.dashboardKey || manifest.dashboard.key;
    var fetchFn = opts.fetch;
    if (!fetchFn || !dashboardKey) {
      console.error('[SPAR] live mode requires options.fetch and dashboardKey (or manifest.dashboard.key)');
      return;
    }

    (manifest.controls || []).forEach(function (c) {
      if (c.param != null && c.default !== undefined) {
        /* Live-mode boot seeds paramState BEFORE the controls bar is
           built, so magic date tokens (`today`, `yesterday`, etc.) need
           to be resolved here too — otherwise the first URL the runtime
           builds would carry the literal text `"today"` to /api/data and
           the server-side `renderBindLiteral` would resolve it a second
           time, masking the bug only when params are typed `date`. Cheaper
           and clearer to resolve once at the runtime boundary. */
        var resolvedC = c.kind === 'date' ? resolveDateDefaultExpr(c.default) : null;
        state.paramState[c.param] = resolvedC !== null ? resolvedC : String(c.default);
      }
    });

    state.mode = 'live';
    /* In live mode we fetch every widget query AND every control's
       `options_from.query`. Without the latter, a multiselect populated
       from a query that no widget references would never receive data and
       the dropdown would stay empty. `buildSearchParamsForQuery` is used
       per query so each one binds its own param schema; controls-only
       queries simply skip the param threading when their schema is empty. */
    var queries = allManifestQueryNames(manifest);
    var initialBoot = true;

    /* Per-query progressive fetch. Each `/api/data/<q>` round-trip fires
       independently — a widget bound to query A renders as soon as A returns,
       even while B and C are still in flight. Previously the whole grid
       waited for the slowest query (`Promise.all`), which on dashboards
       with one heavy master + several light siblings froze every tile in
       "Loading…" for the duration of the slow one.

       When a query lands we call `updateWidgetsForQuery(q)`, which
       re-renders ONLY the widgets bound to that query — sibling widgets
       backed by other queries keep their existing Chart.js animations,
       AG Grid scroll/sort/selection state, and DOM nodes untouched. The
       earlier rAF-coalesced full-grid rebuild had a visible regression
       where widgets 1+2 (from query A) re-rendered when query B landed
       for widget 3.

       Failures are recorded per-query in `state.queryErrors[q]`:
       the per-widget render path then shows `buildWidgetErrorBody` in
       just the affected widgets while the rest of the dashboard renders
       normally — and crucially the mount is NEVER wiped, so a fetch
       error can't feed a render-error → mount-wipe → rebuild loop the
       way `Promise.all`'s shared `.catch` used to.

       Called once on boot, then again on every control change via
       `scheduleRerender` (which delegates to this in live mode). On a
       refetch the existing rows stay visible until the new ones arrive
       (stale-while-revalidate) — `loadedQueries` is intentionally not
       reset, only `queryErrors` is cleared per-query on the next success. */
    function reloadLiveData() {
      if (queries.length === 0) {
        initialBoot = false;
        return Promise.resolve();
      }
      var pending = queries.length;
      return new Promise(function (resolve) {
        queries.forEach(function (q) {
          var qs = buildSearchParamsForQuery(q, manifest, state.paramState);
          Promise.resolve()
            .then(function () { return fetchFn(q, qs); })
            .then(
              function (j) {
                lastDataByQuery[q] = (j && j.rows) || [];
                state.queryErrors[q] = null;
              },
              function (err) {
                /* Keep any previously-loaded rows visible (stale data is
                   better than a sudden blank tile during a refetch) — the
                   widget tile just flips to the error body until a future
                   successful fetch clears it. */
                state.queryErrors[q] = err;
                console.warn('[SPAR] query failed:', q, err);
              },
            )
            .then(function () {
              state.loadedQueries[q] = 1;
              updateWidgetsForQuery(q);
              pending--;
              if (pending === 0) {
                initialBoot = false;
                resolve();
              }
            });
        });
      });
    }
    state.reloadLiveData = reloadLiveData;
    /* Paint the chrome (header, controls, tabs, widget skeletons) BEFORE
       the first /api/data round-trip — otherwise the iframe stays blank
       for the full duration of the slowest query. Widgets whose `query`
       isn't in `state.loadedQueries` yet route through the "Loading…"
       placeholder body in `renderWidgetsInto`; each per-query progressive
       update flips the corresponding widgets to their real bodies as soon
       as the row payload lands. */
    buildDom({});
    reloadLiveData();
  }

  global.SPAR = {
    version: 'spar-dash-engine@1',
    render: render,
  };
})(typeof window !== 'undefined' ? window : globalThis);
