# SPAR Dashboard Runtime

Standalone browser runtime for rendering SPAR `dashboard.manifest.v1` documents — KPIs, tables, charts, filters, tabs. No build step.

## Files

- `spar-dash-transform.js` — row transform pipeline (`window.SparDashTransform`).
- `spar-dash-render.js` — manifest renderer (`window.SPAR.render`).
- `spar-dash.mcp.min.css` — styles (dark/light themed).

Minified `*.mcp.min.*` builds also provided.

## Usage

Peer deps on the page: [Chart.js](https://www.chartjs.org/), [ag-grid-community](https://www.ag-grid.com/), and `spar-dash-transform.js` — in that order, before `spar-dash-render.js`.

```html
<link rel="stylesheet" href="spar-dash.mcp.min.css" />
<div id="spar-dashboard-mount" class="spar-dash"></div>

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script src="https://cdn.jsdelivr.net/npm/ag-grid-community/dist/ag-grid-community.min.js"></script>
<script src="spar-dash-transform.mcp.min.js"></script>
<script src="spar-dash-render.mcp.min.js"></script>
<script>
  SPAR.render(manifest, { mode: 'preview', data: { my_query: { rows: [] } } });
</script>
```

For live mode pass `{ mode: 'live', fetch: (queryName, queryString) => Promise<{rows}> }`.

## License

MIT. See [LICENSE](./LICENSE).
