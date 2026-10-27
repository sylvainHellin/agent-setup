-- annotations.lua plugin spec
-- Persistent multi-file code annotations with sign markers, Telescope browsing,
-- and structured markdown export.

local annotations = require 'custom.annotations'

-- --- Sign setup ---

local SIGN_GROUP = 'annotations'
local SIGN_NAME = 'AnnotationMark'
local SIGN_UNRESOLVED = 'AnnotationUnresolved'
local GENERAL_NS = vim.api.nvim_create_namespace 'annotations_general'

local function define_signs()
  vim.fn.sign_define(SIGN_NAME, { text = '󰆈', texthl = 'DiagnosticInfo' })
  vim.fn.sign_define(SIGN_UNRESOLVED, { text = '󰆈', texthl = 'DiagnosticWarn' })
end

--- Place signs for all annotations in a buffer; the general comment shows as
--- virtual lines above line 1 instead, since it belongs to no line.
--- @param bufnr integer
--- @param file string relative path
local function place_signs(bufnr, file)
  vim.fn.sign_unplace(SIGN_GROUP, { buffer = bufnr })
  vim.api.nvim_buf_clear_namespace(bufnr, GENERAL_NS, 0, -1)
  local anns = annotations.get_file(file)
  for _, a in ipairs(anns) do
    if a.line == annotations.GENERAL_LINE then
      local virt = {}
      for i, l in ipairs(vim.split(a.comment, '\n', { plain = true })) do
        local prefix = i == 1 and '󰆈 General: ' or '           '
        table.insert(virt, { { prefix .. l, 'DiagnosticInfo' } })
      end
      table.insert(virt, { { '', 'Normal' } })
      pcall(vim.api.nvim_buf_set_extmark, bufnr, GENERAL_NS, 0, 0, { virt_lines = virt, virt_lines_above = true })
    else
      local name = a.unresolved and SIGN_UNRESOLVED or SIGN_NAME
      vim.fn.sign_place(0, SIGN_GROUP, name, bufnr, { lnum = a.line, priority = 20 })
    end
  end
end

--- Get buffer lines as a 1-indexed table.
--- @param bufnr integer
--- @return string[]
local function get_buf_lines(bufnr)
  return vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
end

--- Relocate + refresh signs for the current buffer.
--- @param bufnr integer
local function refresh_buffer(bufnr)
  local abs = vim.api.nvim_buf_get_name(bufnr)
  if abs == '' then
    return
  end
  local file = annotations.rel_path(abs)
  local lines = get_buf_lines(bufnr)
  annotations.relocate(file, lines)
  place_signs(bufnr, file)
end

--- Refresh signs in all loaded buffers.
local function refresh_all_buffers()
  for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(bufnr) and vim.bo[bufnr].buflisted then
      refresh_buffer(bufnr)
    end
  end
end

-- --- Helpers ---

--- Get the visual selection text and start line.
--- Must be called from a visual-mode mapping (before mode exits)
--- or right after exiting visual mode (marks '< '> are set).
--- @return string content selected text (joined with newlines if multi-line)
--- @return integer line 1-based start line of the selection
local function get_visual_selection()
  -- Exit visual mode so '< and '> marks are set
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes('<Esc>', true, false, true), 'nx', false)
  local start_pos = vim.api.nvim_buf_get_mark(0, '<')
  local end_pos = vim.api.nvim_buf_get_mark(0, '>')
  local start_line = start_pos[1]
  local start_col = start_pos[2]
  local end_line = end_pos[1]
  local end_col = end_pos[2]

  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  if #lines == 0 then
    return '', start_line
  end

  -- Trim to selection columns
  if #lines == 1 then
    lines[1] = lines[1]:sub(start_col + 1, end_col + 1)
  else
    lines[1] = lines[1]:sub(start_col + 1)
    lines[#lines] = lines[#lines]:sub(1, end_col + 1)
  end

  return table.concat(lines, '\n'), start_line
end

-- --- Floating input helpers ---

--- Open a multi-line floating scratch buffer for comment editing.
--- The float wraps long lines and grows with the text up to half the screen.
--- @param title string
--- @param initial string initial content
--- @param on_save fun(text: string)
--- @param allow_empty? boolean call on_save with '' when the buffer is emptied
local function float_editor(title, initial, on_save, allow_empty)
  local buf = vim.api.nvim_create_buf(false, true)
  -- Give the buffer a name so BufWriteCmd fires without E32
  vim.api.nvim_buf_set_name(buf, 'annotation://' .. vim.fn.localtime())
  vim.bo[buf].buftype = 'acwrite'
  vim.bo[buf].filetype = 'markdown'
  vim.bo[buf].bufhidden = 'wipe'

  -- Set initial content
  local init_lines = vim.split(initial, '\n', { plain = true })
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, init_lines)
  vim.bo[buf].modified = false

  -- Float dimensions: wide enough for a paragraph, tall enough for a few,
  -- growing with the wrapped text (see fit_height below)
  local width = math.min(110, math.floor(vim.o.columns * 0.8))
  local min_height = math.min(10, vim.o.lines - 4)
  local max_height = math.max(min_height, math.floor(vim.o.lines * 0.5))

  --- Rows the text needs once wrapped, plus one spare line, clamped.
  local function fit_height()
    local rows = 1
    for _, l in ipairs(vim.api.nvim_buf_get_lines(buf, 0, -1, false)) do
      rows = rows + math.max(1, math.ceil(vim.fn.strdisplaywidth(l) / width))
    end
    return math.max(min_height, math.min(max_height, rows))
  end

  local height = fit_height()
  local row = math.floor((vim.o.lines - height) / 2)
  local col = math.floor((vim.o.columns - width) / 2)

  local win = vim.api.nvim_open_win(buf, true, {
    relative = 'editor',
    width = width,
    height = height,
    row = row,
    col = col,
    style = 'minimal',
    border = 'rounded',
    title = ' ' .. title .. ' ',
    title_pos = 'center',
    footer = ' <C-s> save | q cancel ',
    footer_pos = 'center',
  })
  vim.wo[win].wrap = true
  vim.wo[win].linebreak = true

  vim.api.nvim_create_autocmd({ 'TextChanged', 'TextChangedI' }, {
    buffer = buf,
    callback = function()
      if not vim.api.nvim_win_is_valid(win) then
        return
      end
      local h = fit_height()
      if h ~= vim.api.nvim_win_get_height(win) then
        vim.api.nvim_win_set_config(win, {
          relative = 'editor',
          row = math.floor((vim.o.lines - h) / 2),
          col = col,
          width = width,
          height = h,
        })
      end
    end,
  })

  local closed = false
  local function close_win()
    if not closed and vim.api.nvim_win_is_valid(win) then
      closed = true
      vim.api.nvim_win_close(win, true)
    end
  end

  local function save_and_close()
    local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
    local text = vim.trim(table.concat(lines, '\n'))
    close_win()
    if text ~= '' or allow_empty then
      on_save(text)
    end
  end

  -- BufWriteCmd: intercept :w / <C-s> to collect content and close
  vim.api.nvim_create_autocmd('BufWriteCmd', {
    buffer = buf,
    callback = function()
      save_and_close()
    end,
  })

  -- q / Esc to cancel (normal mode only)
  vim.keymap.set('n', 'q', close_win, { buffer = buf, nowait = true })
  vim.keymap.set('n', '<Esc>', close_win, { buffer = buf, nowait = true })

  -- Start in insert mode at end of buffer for immediate typing
  vim.api.nvim_win_set_cursor(win, { #init_lines, #(init_lines[#init_lines] or '') })
  vim.cmd 'startinsert!'
end

-- --- Telescope picker ---

local function telescope_list()
  local ok, pickers = pcall(require, 'telescope.pickers')
  if not ok then
    vim.notify('Telescope not available', vim.log.levels.ERROR)
    return
  end
  local finders = require 'telescope.finders'
  local conf = require('telescope.config').values
  local actions = require 'telescope.actions'
  local action_state = require 'telescope.actions.state'

  local all = annotations.get_all()
  local entries = {}
  for file, anns in pairs(all) do
    for _, a in ipairs(anns) do
      table.insert(entries, {
        file = file,
        line = a.line,
        content = a.content,
        comment = a.comment,
        unresolved = a.unresolved,
        display = file
          .. ':'
          .. (a.line == annotations.GENERAL_LINE and 'general' or a.line)
          .. ' · '
          .. a.comment:gsub('\n', ' '):sub(1, 60),
      })
    end
  end

  table.sort(entries, function(a, b)
    if a.file == b.file then
      return a.line < b.line
    end
    return a.file < b.file
  end)

  pickers
    .new({}, {
      prompt_title = 'Annotations',
      finder = finders.new_table {
        results = entries,
        entry_maker = function(entry)
          return {
            value = entry,
            display = entry.display,
            ordinal = entry.file .. ' ' .. entry.comment,
            filename = entry.file,
            lnum = math.max(1, entry.line),
          }
        end,
      },
      sorter = conf.generic_sorter {},
      previewer = conf.grep_previewer {},
      attach_mappings = function(prompt_bufnr, map)
        -- Enter: jump to annotation
        actions.select_default:replace(function()
          local selection = action_state.get_selected_entry()
          actions.close(prompt_bufnr)
          if selection then
            local v = selection.value
            vim.cmd('edit ' .. vim.fn.fnameescape(v.file))
            vim.api.nvim_win_set_cursor(0, { math.max(1, v.line), 0 })
          end
        end)
        -- C-d: delete annotation
        map('i', '<C-d>', function()
          local selection = action_state.get_selected_entry()
          if selection then
            local v = selection.value
            annotations.mutate(nil, nil, function()
              annotations.delete(v.file, v.line)
            end)
            -- Refresh signs in the buffer if it's loaded
            for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
              if vim.api.nvim_buf_is_loaded(bufnr) then
                local bname = annotations.rel_path(vim.api.nvim_buf_get_name(bufnr))
                if bname == v.file then
                  vim.fn.sign_unplace(SIGN_GROUP, { buffer = bufnr })
                  place_signs(bufnr, v.file)
                end
              end
            end
            -- Close and re-open picker to refresh entries
            actions.close(prompt_bufnr)
            vim.schedule(telescope_list)
          end
        end)
        map('n', '<C-d>', function()
          local selection = action_state.get_selected_entry()
          if selection then
            local v = selection.value
            annotations.mutate(nil, nil, function()
              annotations.delete(v.file, v.line)
            end)
            for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
              if vim.api.nvim_buf_is_loaded(bufnr) then
                local bname = annotations.rel_path(vim.api.nvim_buf_get_name(bufnr))
                if bname == v.file then
                  vim.fn.sign_unplace(SIGN_GROUP, { buffer = bufnr })
                  place_signs(bufnr, v.file)
                end
              end
            end
            actions.close(prompt_bufnr)
            vim.schedule(telescope_list)
          end
        end)
        return true
      end,
    })
    :find()
end

-- --- Keymaps ---

local function setup_keymaps()
  -- Add comment (multi-line editor); normal mode: whole line, visual mode: selection
  vim.keymap.set('n', '<leader>ca', function()
    local bufnr = vim.api.nvim_get_current_buf()
    local abs = vim.api.nvim_buf_get_name(bufnr)
    if abs == '' then
      vim.notify('Buffer has no file', vim.log.levels.WARN)
      return
    end
    local file = annotations.rel_path(abs)
    local line = vim.api.nvim_win_get_cursor(0)[1]
    local content = vim.api.nvim_buf_get_lines(bufnr, line - 1, line, false)[1] or ''
    float_editor('Add Comment', '', function(comment)
      annotations.mutate(file, get_buf_lines(bufnr), function()
        annotations.add(file, line, content, comment)
      end)
      place_signs(bufnr, file)
    end)
  end, { desc = '[C]omment: [A]dd' })

  vim.keymap.set('v', '<leader>ca', function()
    local bufnr = vim.api.nvim_get_current_buf()
    local abs = vim.api.nvim_buf_get_name(bufnr)
    if abs == '' then
      vim.notify('Buffer has no file', vim.log.levels.WARN)
      return
    end
    local file = annotations.rel_path(abs)
    local content, line = get_visual_selection()
    float_editor('Add Comment', '', function(comment)
      annotations.mutate(file, get_buf_lines(bufnr), function()
        annotations.add(file, line, content, comment)
      end)
      place_signs(bufnr, file)
    end)
  end, { desc = '[C]omment: [A]dd selection' })

  -- General comment on the whole file (one per file): adds, or edits the
  -- existing one; saving it empty deletes it
  vim.keymap.set('n', '<leader>cg', function()
    local bufnr = vim.api.nvim_get_current_buf()
    local abs = vim.api.nvim_buf_get_name(bufnr)
    if abs == '' then
      vim.notify('Buffer has no file', vim.log.levels.WARN)
      return
    end
    local file = annotations.rel_path(abs)
    local existing = annotations.get(file, annotations.GENERAL_LINE)
    local title = existing and 'Edit General Comment' or 'General Comment'
    float_editor(title, existing and existing.comment or '', function(comment)
      annotations.mutate(file, get_buf_lines(bufnr), function()
        if comment == '' then
          annotations.delete(file, annotations.GENERAL_LINE)
        else
          annotations.add(file, annotations.GENERAL_LINE, '', comment)
        end
      end)
      place_signs(bufnr, file)
    end, existing ~= nil)
  end, { desc = '[C]omment: [G]eneral (whole file)' })

  -- Edit comment (multi-line, pre-filled)
  vim.keymap.set('n', '<leader>ce', function()
    local bufnr = vim.api.nvim_get_current_buf()
    local abs = vim.api.nvim_buf_get_name(bufnr)
    if abs == '' then
      return
    end
    local file = annotations.rel_path(abs)
    local line = vim.api.nvim_win_get_cursor(0)[1]
    local existing = annotations.get(file, line)
    if not existing then
      vim.notify('No annotation on this line', vim.log.levels.INFO)
      return
    end
    float_editor('Edit Comment', existing.comment, function(comment)
      annotations.mutate(file, get_buf_lines(bufnr), function()
        annotations.edit(file, line, comment)
      end)
      place_signs(bufnr, file)
    end)
  end, { desc = '[C]omment: [E]dit' })

  -- Delete comment
  vim.keymap.set('n', '<leader>cd', function()
    local bufnr = vim.api.nvim_get_current_buf()
    local abs = vim.api.nvim_buf_get_name(bufnr)
    if abs == '' then
      return
    end
    local file = annotations.rel_path(abs)
    local line = vim.api.nvim_win_get_cursor(0)[1]
    if not annotations.get(file, line) then
      vim.notify('No annotation on this line', vim.log.levels.INFO)
      return
    end
    annotations.mutate(file, get_buf_lines(bufnr), function()
      annotations.delete(file, line)
    end)
    place_signs(bufnr, file)
    vim.notify('Annotation deleted', vim.log.levels.INFO)
  end, { desc = '[C]omment: [D]elete' })

  -- View comment (floating preview)
  vim.keymap.set('n', '<leader>cv', function()
    local bufnr = vim.api.nvim_get_current_buf()
    local abs = vim.api.nvim_buf_get_name(bufnr)
    if abs == '' then
      return
    end
    local file = annotations.rel_path(abs)
    local line = vim.api.nvim_win_get_cursor(0)[1]
    local a = annotations.get(file, line)
    if not a then
      vim.notify('No annotation on this line', vim.log.levels.INFO)
      return
    end
    local preview_lines = vim.split(a.comment, '\n', { plain = true })
    local width = 0
    for _, l in ipairs(preview_lines) do
      width = math.max(width, #l)
    end
    width = math.min(math.max(width + 2, 30), 80)
    local pbuf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_lines(pbuf, 0, -1, false, preview_lines)
    vim.bo[pbuf].modifiable = false
    vim.bo[pbuf].filetype = 'markdown'
    local pwin = vim.api.nvim_open_win(pbuf, true, {
      relative = 'cursor',
      row = 1,
      col = 0,
      width = width,
      height = #preview_lines,
      style = 'minimal',
      border = 'rounded',
      title = ' Comment ',
      title_pos = 'center',
    })
    -- Close on q, Esc, or leaving window
    local function close()
      if vim.api.nvim_win_is_valid(pwin) then
        vim.api.nvim_win_close(pwin, true)
      end
    end
    vim.keymap.set('n', 'q', close, { buffer = pbuf, nowait = true })
    vim.keymap.set('n', '<Esc>', close, { buffer = pbuf, nowait = true })
    vim.api.nvim_create_autocmd('WinLeave', {
      buffer = pbuf,
      once = true,
      callback = close,
    })
  end, { desc = '[C]omment: [V]iew' })

  -- List all (Telescope)
  vim.keymap.set('n', '<leader>cl', function()
    annotations.reload_if_changed()
    if annotations.count() == 0 then
      vim.notify('No annotations', vim.log.levels.INFO)
      return
    end
    telescope_list()
  end, { desc = '[C]omment: [L]ist (Telescope)' })

  -- Export current buffer's annotations to clipboard only
  vim.keymap.set('n', '<leader>cx', function()
    local bufnr = vim.api.nvim_get_current_buf()
    local abs = vim.api.nvim_buf_get_name(bufnr)
    if abs == '' then
      vim.notify('Buffer has no file', vim.log.levels.WARN)
      return
    end
    local file = annotations.rel_path(abs)
    if annotations.reload_if_changed() then
      refresh_buffer(bufnr)
    end
    local n = annotations.count_file(file)
    if n == 0 then
      vim.notify('No annotations in this file', vim.log.levels.INFO)
      return
    end
    local md = annotations.export_markdown(file)
    vim.fn.setreg('+', md)
    vim.notify(n .. ' annotation(s) from ' .. file .. ' copied to clipboard', vim.log.levels.INFO)
  end, { desc = '[C]omment: E[x]port (current file)' })

  -- Export all annotations to clipboard + .nvim/annotations-export.md
  vim.keymap.set('n', '<leader>cX', function()
    if annotations.reload_if_changed() then
      refresh_all_buffers()
    end
    local n = annotations.count()
    if n == 0 then
      vim.notify('No annotations to export', vim.log.levels.INFO)
      return
    end
    local md = annotations.export_markdown()
    -- Clipboard
    vim.fn.setreg('+', md)
    -- File
    local dir = vim.fn.getcwd() .. '/.nvim'
    vim.fn.mkdir(dir, 'p')
    local export_path = dir .. '/annotations-export.md'
    local f = io.open(export_path, 'w')
    if f then
      f:write(md)
      f:close()
    end
    vim.notify(n .. ' annotation(s) exported to clipboard + .nvim/annotations-export.md', vim.log.levels.INFO)
  end, { desc = '[C]omment: E[x]port all' })

  -- Clear current file
  vim.keymap.set('n', '<leader>cr', function()
    local bufnr = vim.api.nvim_get_current_buf()
    local abs = vim.api.nvim_buf_get_name(bufnr)
    if abs == '' then
      return
    end
    local file = annotations.rel_path(abs)
    local n = annotations.count_file(file)
    if n == 0 then
      vim.notify('No annotations in this file', vim.log.levels.INFO)
      return
    end
    vim.ui.select({ 'Yes', 'No' }, { prompt = 'Clear ' .. n .. ' annotation(s) for this file?' }, function(choice)
      if choice == 'Yes' then
        annotations.mutate(nil, nil, function()
          annotations.clear_file(file)
        end)
        vim.fn.sign_unplace(SIGN_GROUP, { buffer = bufnr })
        vim.notify(n .. ' annotation(s) cleared', vim.log.levels.INFO)
      end
    end)
  end, { desc = '[C]omment: Clea[r] file' })

  -- Clear all
  vim.keymap.set('n', '<leader>cR', function()
    local n = annotations.count()
    if n == 0 then
      vim.notify('No annotations', vim.log.levels.INFO)
      return
    end
    vim.ui.select({ 'Yes', 'No' }, { prompt = 'Clear ALL ' .. n .. ' annotation(s)?' }, function(choice)
      if choice == 'Yes' then
        annotations.mutate(nil, nil, function()
          annotations.clear_all()
        end)
        -- Remove signs from all buffers
        for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
          if vim.api.nvim_buf_is_loaded(bufnr) then
            vim.fn.sign_unplace(SIGN_GROUP, { buffer = bufnr })
          end
        end
        vim.notify(n .. ' annotation(s) cleared', vim.log.levels.INFO)
      end
    end)
  end, { desc = '[C]omment: Clea[R] all' })
end

-- --- Plugin spec ---

return {
  -- This is a virtual "local plugin": no repo, just config.
  -- We use the dir field pointing at the nvim config to satisfy lazy.nvim.
  {
    dir = vim.fn.stdpath 'config',
    name = 'annotations',
    lazy = false,
    config = function()
      define_signs()
      annotations.load()
      setup_keymaps()

      local augroup = vim.api.nvim_create_augroup('annotations', { clear = true })

      -- Refresh signs on buffer load
      vim.api.nvim_create_autocmd({ 'BufReadPost', 'BufNewFile' }, {
        group = augroup,
        callback = function(ev)
          refresh_buffer(ev.buf)
        end,
      })

      -- Pick up annotations another tool wrote
      vim.api.nvim_create_autocmd({ 'FocusGained', 'BufEnter' }, {
        group = augroup,
        callback = function()
          if annotations.reload_if_changed() then
            refresh_all_buffers()
          end
        end,
      })

      -- Re-run relocation after save (lines may have shifted)
      vim.api.nvim_create_autocmd('BufWritePost', {
        group = augroup,
        callback = function(ev)
          refresh_buffer(ev.buf)
        end,
      })
    end,
  },
}
