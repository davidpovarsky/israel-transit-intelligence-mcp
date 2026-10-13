# Israel Transit Intelligence MCP

Portable, dependency-free Node.js MCP stdio servers for Israeli public transport. The package contains the existing Curlbus fallback tools and BusNearby tools, preserving their tool names and request behavior.

## Run directly

```bash
npx --yes israel-transit-intelligence-mcp@1.2.0 --server=curlbus
npx --yes israel-transit-intelligence-mcp@1.2.0 --server=busnearby
```

## Manus MCP configuration

```json
{
  "mcpServers": {
    "israel-curlbus-fallback": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "israel-transit-intelligence-mcp@1.2.0", "--server=curlbus"]
    },
    "busnearby-israel": {
      "type": "stdio",
      "command": "npx",
      "args": ["--yes", "israel-transit-intelligence-mcp@1.2.0", "--server=busnearby"]
    }
  }
}
```

The package has no runtime dependencies, uses Node 18+ built-in `fetch`, and contains no absolute filesystem paths or external files. It must be published to a stable registry before the Manus connectors can use the `npx` form in independent tasks.
