# Israel Transit Intelligence MCP v1.3.0

Portable, zero-runtime-dependency, read-only MCP stdio servers for Israeli public transport. **Important:** available data quality depends on the upstream provider. Do not confuse scheduled trips with live vehicle positions.

## Install from GitHub (no npm publication)

The package is **not published to npm**. Use the public GitHub version tag once `v1.3.0` is created:

```sh
npx --yes github:davidpovarsky/israel-transit-intelligence-mcp#v1.3.0 --server=curlbus
npx --yes github:davidpovarsky/israel-transit-intelligence-mcp#v1.3.0 --server=busnearby
npx --yes github:davidpovarsky/israel-transit-intelligence-mcp#v1.3.0 --server=openbus
```

Until the tag is created, use the commit SHA of the merged revision in place of `v1.3.0`. Do not use an unpublished npm package name.

### Manus configuration (replace three existing connections; keep working Railways connection)

```json
{
  "mcpServers": {
    "israel-transit-curlbus-fallback": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "github:davidpovarsky/israel-transit-intelligence-mcp#v1.3.0", "--server=curlbus"]
    },
    "bus-nearby-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "github:davidpovarsky/israel-transit-intelligence-mcp#v1.3.0", "--server=busnearby"]
    },
    "openbus-israel": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "github:davidpovarsky/israel-transit-intelligence-mcp#v1.3.0", "--server=openbus"]
    }
  }
}
```

The JSON above includes only the **three changed** connections. Preserve the existing independent Israel Railways MCP, which continues to provide `list_stations` and `search_routes`. The new Curlbus server also offers `get_rail_service_updates` from the **official rail.co.il website** as a conditional fallback when the Railways MCP's `get_service_updates` endpoint returns HTTP 404. The fallback returns an explicit unavailable error if the official page is blocked or cannot be reliably parsed (including JavaScript-only responses). Official pages returned HTTP 403 from GitHub-hosted CI during initial testing, so this is **not** yet a reliable machine-readable replacement. A link alone is **not** treated as successful data extraction. Use a browser-capable agent to review the official rail updates page separately if needed; do not claim no disruptions on 403.

### Sources and tool behavior

- **Curlbus** (`--server=curlbus`): `get_curlbus_arrivals`, `get_official_gtfs_metadata`, `get_rail_service_updates`, `get_transit_source_links`. Arrival visits are from a community source; distinguish realtime estimates from scheduled values based on actual provider fields. Empty arrivals do not prove cancellation.
- **BusNearby** (`--server=busnearby`): `geocode`, `directions`. Request construction follows the original Shmuelmb/busnearby-mcp implementation. HTTP 403 is an upstream provider-denied response, not a package/install failure; it is **not retried or bypassed**. If the BusNearby geocoder fails, an independent OpenStreetMap Nominatim geocoder can return coordinates (at most 3 candidates) with clearly stated provenance; this does **not** make BusNearby transit directions work. Nominatim queries are occasional interactive requests with an identifying User-Agent and per-process rate limiting; no bulk use. The public official interactive transit planner https://route.bus.gov.il/ is linked when directions are unavailable. HTTP 429 and transient errors have explicit diagnostics; no routes are invented.
- **OpenBus** (`--server=openbus`): `find_stops`, `search_routes`, `get_stop_arrivals`, `get_vehicle_locations`, `get_route_timetable`, `get_ride_performance`, `list_agencies`. Bounding-box keys are translated to documented `lat__greater_or_equal` / `lat__lower_or_equal` and longitude equivalents. Queries enforce a recent UTC time window and descending timestamp order. Records fail closed unless snapshot, recorded timestamp, and scheduled ride time all agree. Results still **do not guarantee live GPS**.
- **Israel Railways**: keep existing independent package for stations/timetables. `get_service_updates` still relies on a third-party wrapper with an HTTP 404. The official-site fallback is provided as a separate tool in the Curlbus server.

**Do not present OpenBus `get_stop_arrivals` as live ETAs.** Its public API currently documents GTFS planned times only. Prefer Curlbus for current stop arrivals, while checking its source timestamps and fields.

## Tests

```sh
npm test
npm run pack:check
```

Unit tests use mocked provider responses, including failure cases. Passing them proves local argument handling and MCP behavior, **not** that providers are available live. Real provider checks and Manus cross-task persistence need separate integration acceptance in the production environment.

## Licensing / acknowledgements

This adapter uses the public OpenBus Stride API by The Public Knowledge Workshop and publicly documented BusNearby request semantics from [Shmuelmb/busnearby-mcp](https://github.com/Shmuelmb/busnearby-mcp). It does not guarantee provider availability or contain official affiliation with Israeli transit operators.