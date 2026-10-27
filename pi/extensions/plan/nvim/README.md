# nvim annotations plugin

The nvim side of `/annotate`: line and general comments stored in `.nvim/annotations.json` under nvim's cwd, which `../review.ts` reads back.

Install it into a lazy.nvim config that loads specs from `lua/custom/plugins/` (the kickstart.nvim layout):

```sh
cp lua/custom/annotations.lua ~/.config/nvim/lua/custom/
cp lua/custom/plugins/annotations.lua ~/.config/nvim/lua/custom/plugins/
```

With another layout, put `annotations.lua` where `require 'custom.annotations'` finds it, or change that line in the spec.

Keys: `<leader>ca` comments the line or visual selection, `<leader>cg` writes a general comment on the whole file, `<leader>ce` edits, `<leader>cd` deletes, `<leader>cv` shows the comment, `<leader>cl` lists all (needs Telescope), `<leader>cx` and `<leader>cX` export to the clipboard.
