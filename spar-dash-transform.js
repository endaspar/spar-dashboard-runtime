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
    if (op.from_param !== undefined) {
      var raw = paramState && paramState[op.from_param];
      if (raw == null) return true;
      var rawStr = String(raw);
      if (rawStr === '') return true;
      var notIn = op.when_not_in;
      if (Array.isArray(notIn)) {
        for (var ni = 0; ni < notIn.length; ni++) {
          if (rawStr === String(notIn[ni])) return true;
        }
      }
      var values = rawStr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
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
      case 'count_distinct':
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
        for (var field in aggSpec) {
          if (field === 'op') continue;
          row[field] = applyAgg(groupRows, field, aggSpec[field]);
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
          out = out.map(function (r) {
            return pickRow(r, op.fields);
          });
          break;
        case 'sort': {
          var dir = op.dir === 'asc' ? 1 : -1;
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
          var next = ops[i + 1];
          if (next && typeof next === 'object' && next.op === 'aggregate') {
            var raw = Object.assign({}, next);
            delete raw.op;
            var aggSpec = {};
            for (var k in raw) {
              if (typeof raw[k] === 'string') aggSpec[k] = raw[k];
            }
            out = rollup(out, op.fields, aggSpec);
            i++;
          } else {
            out = rollup(out, op.fields, undefined);
          }
          break;
        }
        case 'aggregate':
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
