-- annotations.lua: persistent multi-file code annotations
-- Storage: .nvim/annotations.json in project root (vim.fn.getcwd())
-- Other tools (pi's annotate extension, editor plugins) may read and write the
-- same file and format.

local M = {}

--- @class Annotation
--- @field line integer
--- @field content string
--- @field comment string
--- @field created string
--- @field unresolved? boolean

--- @alias AnnotationStore table<string, Annotation[]>

--- @type AnnotationStore
local store = {}

local SEARCH_RANGE = 20

--- Line number of a file's general comment: one per file, tied to no line,
--- with empty `content`. Real lines start at 1, so 0 never collides.
M.GENERAL_LINE = 0

-- --- File I/O ---

local function store_path()
  return vim.fn.getcwd() .. '/.nvim/annotations.json'
end

--- mtime of the store file at our last read or write, to spot writes from
--- another tool (the file may be shared).
local last_mtime = nil

local function file_mtime()
  local st = vim.uv.fs_stat(store_path())
  return st and (st.mtime.sec .. '.' .. st.mtime.nsec) or nil
end

function M.load()
  local p = store_path()
  last_mtime = file_mtime()
  local f = io.open(p, 'r')
  if not f then
    store = {}
    return
  end
  local raw = f:read '*a'
  f:close()
  local ok, data = pcall(vim.json.decode, raw)
  if ok and type(data) == 'table' and data.annotations then
    store = data.annotations
  else
    store = {}
  end
end

function M.save()
  local dir = vim.fn.getcwd() .. '/.nvim'
  vim.fn.mkdir(dir, 'p')
  local p = store_path()
  local payload = vim.json.encode { version = 1, annotations = store }
  local f = io.open(p, 'w')
  if f then
    f:write(payload)
    f:close()
  end
  last_mtime = file_mtime()
end

--- Reload when another process wrote the store since our last read or write.
--- @return boolean changed
function M.reload_if_changed()
  if file_mtime() == last_mtime then
    return false
  end
  M.reload()
  return true
end

-- --- Relative path helper ---

--- Convert an absolute buffer path to a path relative to cwd.
--- @param abs string
--- @return string
function M.rel_path(abs)
  local cwd = vim.fn.getcwd() .. '/'
  if abs:sub(1, #cwd) == cwd then
    return abs:sub(#cwd + 1)
  end
  return abs
end

-- --- CRUD ---

--- Add an annotation. Replaces any existing annotation on the same file+line.
--- @param file string relative path
--- @param line integer 1-based line number
--- @param content string the text at that line
--- @param comment string the user's comment
function M.add(file, line, content, comment)
  if not store[file] then
    store[file] = {}
  end
  -- Remove existing on same line
  M.delete(file, line)
  table.insert(store[file], {
    line = line,
    content = content,
    comment = comment,
    created = os.date '!%Y-%m-%dT%H:%M:%SZ',
  })
  -- Sort by line number
  table.sort(store[file], function(a, b)
    return a.line < b.line
  end)
end

--- Edit an existing annotation's comment text.
--- @param file string
--- @param line integer
--- @param comment string
function M.edit(file, line, comment)
  local anns = store[file]
  if not anns then
    return
  end
  for _, a in ipairs(anns) do
    if a.line == line then
      a.comment = comment
      return
    end
  end
end

--- Delete an annotation at a specific line.
--- @param file string
--- @param line integer
function M.delete(file, line)
  local anns = store[file]
  if not anns then
    return
  end
  for i, a in ipairs(anns) do
    if a.line == line then
      table.remove(anns, i)
      if #anns == 0 then
        store[file] = nil
      end
      return
    end
  end
end

--- Clear all annotations for a file.
--- @param file string
function M.clear_file(file)
  store[file] = nil
end

--- Clear all annotations.
function M.clear_all()
  store = {}
end

--- Get annotation at a specific line (or nil).
--- @param file string
--- @param line integer
--- @return Annotation|nil
function M.get(file, line)
  local anns = store[file]
  if not anns then
    return nil
  end
  for _, a in ipairs(anns) do
    if a.line == line then
      return a
    end
  end
  return nil
end

--- Get all annotations for a file.
--- @param file string
--- @return Annotation[]
function M.get_file(file)
  return store[file] or {}
end

--- Get the full store.
--- @return AnnotationStore
function M.get_all()
  return store
end

--- Count all annotations.
--- @return integer
function M.count()
  local n = 0
  for _, anns in pairs(store) do
    n = n + #anns
  end
  return n
end

--- Count annotations for a file.
--- @param file string
--- @return integer
function M.count_file(file)
  local anns = store[file]
  return anns and #anns or 0
end

-- --- Line drift relocation ---

--- Relocate annotations for a file by verifying stored content against
--- actual buffer lines. If the content at the stored line doesn't match,
--- search +/-SEARCH_RANGE lines for it. Updates line numbers in place.
--- @param file string
--- @param buf_lines string[] 1-indexed table of lines from the buffer
function M.relocate(file, buf_lines)
  local anns = store[file]
  if not anns then
    return
  end
  local total = #buf_lines

  --- Check if stored content matches buffer lines starting at `start_line`.
  --- Handles both single-line and multi-line (visual selection) content.
  --- @param stored string
  --- @param start_line integer
  --- @return boolean
  --- A stored line matches when the buffer line equals it or, for a charwise
  --- selection, contains it (trimmed); an empty stored line needs an empty line.
  local function content_matches(stored, start_line)
    local content_lines = vim.split(stored, '\n', { plain = true })
    for idx, cl in ipairs(content_lines) do
      local bl = buf_lines[start_line + idx - 1]
      if not bl then
        return false
      end
      local b, c = vim.trim(bl), vim.trim(cl)
      if c == '' then
        if b ~= '' then
          return false
        end
      elseif not b:find(c, 1, true) then
        return false
      end
    end
    return true
  end

  for _, a in ipairs(anns) do
    a.unresolved = nil
    if a.line == M.GENERAL_LINE then
      -- General comment: anchored to no line, nothing to relocate
    elseif a.line >= 1 and a.line <= total and content_matches(a.content, a.line) then
      -- Still matches, no drift
    else
      -- Search nearby
      local found = false
      for offset = 1, SEARCH_RANGE do
        for _, candidate in ipairs { a.line + offset, a.line - offset } do
          if candidate >= 1 and candidate <= total then
            if content_matches(a.content, candidate) then
              a.line = candidate
              found = true
              break
            end
          end
        end
        if found then
          break
        end
      end
      if not found then
        a.unresolved = true
      end
    end
  end
  -- Re-sort after potential line changes
  table.sort(anns, function(a, b)
    return a.line < b.line
  end)
end

-- --- Export ---

--- Pick a backtick fence longer than the longest run of backticks inside
--- `s`, so source content that itself contains backticks renders as a clean
--- code span (CommonMark rule). Pads with a space when the content starts or
--- ends with a backtick.
--- @param s string
--- @return string opening fence
--- @return string padding ("" or " ")
local function code_span_fence(s)
  local longest = 0
  for run in s:gmatch '`+' do
    longest = math.max(longest, #run)
  end
  local fence = string.rep('`', longest + 1)
  local pad = (s:sub(1, 1) == '`' or s:sub(-1) == '`') and ' ' or ''
  return fence, pad
end

--- Render all annotations as grouped markdown.
--- @return string
--- Export annotations as markdown. If file_filter is given, only that file's
--- annotations are exported.
--- @param file_filter? string relative path; if nil, exports all files
function M.export_markdown(file_filter)
  local lines = {}
  -- Sort files alphabetically
  local files = {}
  for file in pairs(store) do
    if not file_filter or file == file_filter then
      table.insert(files, file)
    end
  end
  table.sort(files)

  for i, file in ipairs(files) do
    if i > 1 then
      table.insert(lines, '')
    end
    table.insert(lines, '## ' .. file)
    table.insert(lines, '')
    local anns = store[file]
    for j, a in ipairs(anns) do
      if j > 1 then
        table.insert(lines, '')
      end
      local trimmed = vim.trim(a.content)
      if a.line == M.GENERAL_LINE then
        -- General comment: a label and the comment, no quoted source
        table.insert(lines, 'General:')
      else
        -- Plain-text reference line, then a blockquote holding ONLY the source.
        -- A blank line separates the user's comment so it renders as its own
        -- flush-left paragraph (email-style quoting), never as part of the quote.
        local label = a.unresolved and 'Re L' .. a.line .. ' (unresolved):' or 'Re L' .. a.line .. ':'
        table.insert(lines, label)
      end
      if a.line == M.GENERAL_LINE then
        -- nothing to quote
      elseif trimmed:find '\n' then
        -- Multi-line content (from visual selection): use fenced code block
        table.insert(lines, '> ```')
        for _, cl in ipairs(vim.split(trimmed, '\n', { plain = true })) do
          table.insert(lines, '> ' .. cl)
        end
        table.insert(lines, '> ```')
      else
        local fence, pad = code_span_fence(trimmed)
        table.insert(lines, '> ' .. fence .. pad .. trimmed .. pad .. fence)
      end
      table.insert(lines, '')
      table.insert(lines, a.comment)
    end
  end
  return table.concat(lines, '\n')
end

--- Force reload from disk.
function M.reload()
  store = {}
  M.load()
end

--- Read-modify-write: reload from disk so writes from another editor survive,
--- re-anchor `file` to `buf_lines` so line numbers match the signs, apply
--- `fn`, save.
--- @param file string|nil
--- @param buf_lines string[]|nil
--- @param fn fun()
function M.mutate(file, buf_lines, fn)
  M.reload()
  if file and buf_lines then
    M.relocate(file, buf_lines)
  end
  fn()
  M.save()
end
return M
