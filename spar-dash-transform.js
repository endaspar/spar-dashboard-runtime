/**
 * Standalone transform pipeline — keep in sync with src/lib/spar-dash-engine/transform.ts
 * @version spar-dash-engine@1
 */
(function (global) {
  'use strict';

  function compareValues(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    var na = Number(a);
    var nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  }

  /* Match the leading YYYY-MM-DD of a date-shaped string. Mirror of
     DATE_PREFIX_RE in src/lib/spar-dash-engine/transform.ts. */
  var DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})(?:[T\s.]|$)/;

  /* Equality-friendly date normaliser — keep in sync with
     `normalizeMaybeDate` in src/lib/spar-dash-engine/transform.ts. SQL
     warehouses serialise dates inconsistently (`2026-05-09`,
     `2026-05-09 00:00:00.000000`, `2026-05-09T00:00:00Z`); without this
     a `kind: "date"` control's bare ISO emission silently fails to match
     any TIMESTAMP column. Non-date columns hit the no-match branch and
     fall through unchanged. */
  function normalizeMaybeDate(value) {
    if (value instanceof Date) {
      var y = value.getUTCFullYear();
      var mo = value.getUTCMonth() + 1;
      var d = value.getUTCDate();
      return y + '-' + (mo < 10 ? '0' + mo : mo) + '-' + (d < 10 ? '0' + d : d);
    }
    var s = typeof value === 'string' ? value : String(value);
    var m = s.match(DATE_PREFIX_RE);
    return m ? m[1] : s;
  }

  function rowMatchesFilter(row, op, paramState) {
    var v = row[op.field];
    /* Dynamic filter: read current control value from paramState[op.from_param]. */
    if (op.from_param) {
      var raw = paramState && paramState[op.from_param];
      if (raw == null) return true;
      var rawStr = String(raw);
      if (rawStr === '') return true;
      /* Build a skip-set from `when_not_in`. Both the whole raw value AND any
         per-value split entries that match are dropped — keeps multiselect
         payloads like "all,btc" with `when_not_in: ["", "all"]` rendering
         only the real selection ("btc"), matching `resolveFromParamValues`
         in src/lib/spar-dash-engine/transform.ts. */
      var skip = Object.create(null);
      var notIn = op.when_not_in;
      if (Array.isArray(notIn)) {
        for (var ni = 0; ni < notIn.length; ni++) skip[String(notIn[ni])] = true;
      }
      if (skip[rawStr]) return true;
      var values = rawStr
        .split(',')
        .map(function (s) { return s.trim(); })
        .filter(function (s) { return s.length > 0 && !skip[s]; });
      if (!values.length) return true;
      var rowStr = v == null ? '' : String(v);
      /* Date-aware match: a TIMESTAMP column serialised as
         "2026-05-09 00:00:00.000" should match a `kind: "date"` control
         emitting "2026-05-09". Pre-normalise both sides; pure-string
         columns fall through unchanged. */
      var rowNorm = normalizeMaybeDate(v);
      for (var vi = 0; vi < values.length; vi++) {
        if (values[vi] === rowStr) return true;
        if (normalizeMaybeDate(values[vi]) === rowNorm) return true;
      }
      return false;
    }
    if (op.eq !== undefined) {
      if (v === op.eq) return true;
      /* Date-aware equality for hardcoded literals. */
      return normalizeMaybeDate(v) === normalizeMaybeDate(op.eq);
    }
    if (op.ne !== undefined) return v !== op.ne;
    if (op.in_ !== undefined && Array.isArray(op.in_)) {
      var vNorm = normalizeMaybeDate(v);
      return op.in_.some(function (x) {
        return x === v || normalizeMaybeDate(x) === vNorm;
      });
    }
    if (op.gt !== undefined) return compareValues(v, op.gt) > 0;
    if (op.gte !== undefined) return compareValues(v, op.gte) >= 0;
    if (op.lt !== undefined) return compareValues(v, op.lt) < 0;
    if (op.lte !== undefined) return compareValues(v, op.lte) <= 0;
    if (op.regex !== undefined && typeof v === 'string') {
      try {
        return new RegExp(op.regex).test(v);
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  function pickRow(row, fields) {
    var out = {};
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i];
      if (Object.prototype.hasOwnProperty.call(row, f)) out[f] = row[f];
    }
    return out;
  }

  /* Keep in sync with `assertNonEmptyStringArray` in
     src/lib/spar-dash-engine/transform.ts. `group_by` and `select` both
     used to read `op.fields` blind and immediately call `.map(...)` /
     `.length` on it — a missing or non-array `fields` would crash with
     `Cannot read properties of undefined (reading 'map')`, take out the
     entire widget render, and (before per-widget error containment
     existed in the engine) put the dashboard into a re-render loop.
     Now we throw a STRUCTURED error so `buildWidgetErrorBody` can point
     the author straight at the offending op in `transform[i]`. */
  function assertNonEmptyStringArray(value, opLabel, index, fieldName) {
    var ok = false;
    if (Array.isArray(value) && value.length > 0) {
      ok = true;
      for (var i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'string') {
          ok = false;
          break;
        }
      }
    }
    if (!ok) {
      throw new Error(
        "Bad " + opLabel + " op at transform[" + index + "]: '" + fieldName +
          "' must be a non-empty string[] (got " + JSON.stringify(value) + ')',
      );
    }
  }

  function applyAgg(rows, field, agg) {
    var vals = rows
      .map(function (r) {
        return r[field];
      })
      .filter(function (x) {
        return x !== undefined && x !== null;
      });
    switch (agg) {
      case 'sum': {
        var s = 0;
        for (var i = 0; i < vals.length; i++) s += Number(vals[i]);
        return isFinite(s) ? s : null;
      }
      case 'avg': {
        var sm = applyAgg(rows, field, 'sum');
        return vals.length ? sm / vals.length : null;
      }
      case 'count':
        return rows.length;
      case 'distinct_count':
        return new Set(
          vals.map(function (x) {
            return String(x);
          }),
        ).size;
      case 'max': {
        if (!vals.length) return null;
        var m = vals[0];
        for (var j = 1; j < vals.length; j++) if (compareValues(vals[j], m) > 0) m = vals[j];
        return m;
      }
      case 'min': {
        if (!vals.length) return null;
        var m2 = vals[0];
        for (var k = 1; k < vals.length; k++) if (compareValues(vals[k], m2) < 0) m2 = vals[k];
        return m2;
      }
      case 'first':
        return rows[0] ? rows[0][field] ?? null : null;
      default:
        return null;
    }
  }

  /* Pull well-formed { field, op, as } entries out of op.aggs. Anything
     malformed is silently dropped here; the submit-time validator rejects
     it upstream so live dashboards never reach this code with bad data.
     Mirrors `readAggsArray` in src/lib/spar-dash-engine/transform.ts. */
  function readAggsArray(rawOp) {
    var aggs = rawOp && rawOp.aggs;
    var out = [];
    if (!Array.isArray(aggs)) return out;
    for (var i = 0; i < aggs.length; i++) {
      var e = aggs[i];
      if (e && typeof e === 'object' &&
          typeof e.field === 'string' &&
          typeof e.op === 'string' &&
          typeof e.as === 'string') {
        out.push({ field: e.field, op: e.op, as: e.as });
      }
    }
    return out;
  }

  function rollup(rows, groupFields, aggSpec) {
    var groups = new Map();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var key = JSON.stringify(
        groupFields.map(function (f) {
          return r[f];
        }),
      );
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    var out = [];
    groups.forEach(function (groupRows) {
      var row = {};
      for (var g = 0; g < groupFields.length; g++) {
        var f = groupFields[g];
        row[f] = groupRows[0][f];
      }
      if (aggSpec) {
        for (var s = 0; s < aggSpec.length; s++) {
          var spec = aggSpec[s];
          row[spec.as] = applyAgg(groupRows, spec.field, spec.op);
        }
      }
      out.push(row);
    });
    return out;
  }

  function coerceMutateOperand(v) {
    if (v === null || v === undefined || v === '') return 0;
    var n = Number(v);
    return isFinite(n) ? n : 0;
  }

  function applyMutateMultiplyRow(row, outField, leftField, rightField) {
    var next = Object.assign({}, row);
    var p = coerceMutateOperand(row[leftField]) * coerceMutateOperand(row[rightField]);
    next[outField] = isFinite(p) ? p : null;
    return next;
  }

  function applyTransformPipeline(rows, ops, paramState) {
    if (!ops || !ops.length) return rows;
    var out = rows.slice();
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (!op || typeof op !== 'object') continue;
      switch (op.op) {
        case 'filter':
          out = out.filter(function (r) {
            return rowMatchesFilter(r, op, paramState);
          });
          break;
        case 'select':
          assertNonEmptyStringArray(op.fields, 'select', i, 'fields');
          out = out.map(function (r) {
            return pickRow(r, op.fields);
          });
          break;
        case 'sort': {
          if (typeof op.field !== 'string' || !op.field) {
            throw new Error(
              "Bad sort op at transform[" + i + "]: 'field' must be a non-empty string (got " +
                JSON.stringify(op.field) + ')',
            );
          }
          /* Default ascending when `dir` is omitted, per
             `manifest_contract.transforms.sort.shape`. */
          var dir = op.dir === 'desc' ? -1 : 1;
          var f = op.field;
          out = out.slice().sort(function (a, b) {
            return dir * compareValues(a[f], b[f]);
          });
          break;
        }
        case 'limit': {
          var off = op.offset ?? 0;
          out = out.slice(off, off + op.n);
          break;
        }
        case 'group_by': {
          assertNonEmptyStringArray(op.by, 'group_by', i, 'by');
          var next = ops[i + 1];
          if (next && typeof next === 'object' && next.op === 'aggregate') {
            var aggSpec = readAggsArray(next);
            out = rollup(out, op.by, aggSpec.length > 0 ? aggSpec : undefined);
            i++;
          } else {
            out = rollup(out, op.by, undefined);
          }
          break;
        }
        case 'aggregate':
          /* No-op when standalone. group_by + aggregate is a single rollup —
             aggregate is consumed at the group_by step via `i++` above.
             Submit-time validator rejects orphan aggregates upstream. */
          break;
        case 'mutate': {
          var outF = typeof op.field === 'string' ? op.field.trim() : '';
          var pair = op.multiply;
          if (
            outF &&
            Array.isArray(pair) &&
            pair.length === 2 &&
            typeof pair[0] === 'string' &&
            typeof pair[1] === 'string' &&
            pair[0].trim() &&
            pair[1].trim()
          ) {
            var lf = pair[0].trim();
            var rf = pair[1].trim();
            out = out.map(function (r) {
              return applyMutateMultiplyRow(r, outF, lf, rf);
            });
          }
          break;
        }
        default:
          break;
      }
    }
    return out;
  }

  global.SparDashTransform = { applyTransformPipeline: applyTransformPipeline };
})(typeof window !== 'undefined' ? window : globalThis);
