# python-repl

One `python` tool backed by a persistent IPython kernel per pi session.
Variables, imports and loaded data survive between calls.

- `index.ts` spawns `bridge.py` under `uv run --no-project --python 3.13 --with ...` and talks JSON lines to it.
- `bridge.py` drives the kernel with `jupyter_client` over IPC sockets in a private temp dir.
- The kernel starts on the first call in the session's cwd and stops on session shutdown, `/python-reset`, or when the bridge dies (ipykernel's parent poller).
- Libraries: polars, duckdb, pandas, pyarrow, openpyxl, matplotlib, pyyaml, rdflib (`LIBRARIES` in `index.ts`); `pl`, `pd`, `np` and `duckdb` are preloaded.
- A cell that runs past `timeout` is interrupted with SIGINT and keeps its state; if it ignores the interrupt for 10 s, the kernel restarts and the state is lost.
- Output is tail-truncated like bash; the full text goes to a temp file.
- Images (matplotlib) come back as image content, at most four per call.
- Codemode scripts get `structuredContent` (`status`, `output`, `result`, `error`, ...).

Test by hand: `printf '%s\n' '{"id":1,"op":"execute","code":"1+1","timeout":10}' | uv run --no-project --with ipykernel --with jupyter-client --with polars --with duckdb --with pandas --with pyarrow --with openpyxl --with matplotlib --with pyyaml --with rdflib python bridge.py`
