// Flint: a fast drop-in for csv-reader 1.0.0.
// Written from the reference's stated policy (RULES.txt), not copied from it:
// single pass, left to right, BOM dropped, LF/CRLF record ends, empty lines
// skipped, stray CR outside quotes dropped (stray_cr), quoted fields run to
// the next non-doubled quote ("" is one quote, CRLF/lone CR inside read as
// LF), junk after a closing quote appended as-is (quote_junk), a quote that
// never closes is literal and the rest re-read unquoted (unterminated_quote),
// quotes inside unquoted fields literal, fields stay strings, records padded
// (short_row) or cut (long_row) to the first record's width, errors
// {code, line, row} in the order met with line = the 1-based line the record
// starts on and row = its index in rows (null for the header).
//
// Speed: the common cases never touch a character at a time. Unquoted fields
// are sliced between indexOf delimiters, quoted fields are sliced between
// indexOf quotes, and only the rare broken shapes (stray CR, doubled quotes,
// line breaks inside quotes, junk, unterminated quotes) fall back to the
// careful segment loop. No imports, no state kept between calls.

const CR_RE = /\r\n?/g;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  let recordLine = 1;
  let recordRow = null;

  // Slice [a,b) of a quoted segment, turning each CRLF / lone CR into LF
  // and counting the line breaks it holds. Only used on the rare path.
  function transform(a, b) {
    const s = text.slice(a, b);
    const ri = s.indexOf('\r');
    if (ri === -1) {
      let idx = s.indexOf('\n');
      if (idx === -1) return s;
      let cnt = 0;
      while (idx !== -1) { cnt++; idx = s.indexOf('\n', idx + 1); }
      line += cnt;
      return s;
    }
    const t = s.replace(CR_RE, '\n');
    let cnt = 0;
    let idx = t.indexOf('\n');
    while (idx !== -1) { cnt++; idx = t.indexOf('\n', idx + 1); }
    line += cnt;
    return t;
  }

  // Read an unquoted field starting at pos, with `init` already in the
  // value ('' normally, '"' for an unterminated quote, a quoted value for
  // junk). Returns {value, ended} with ended 0=comma, 1=line break, 2=end,
  // and added = characters kept after init. Rare path only: stray CRs.
  function unq(init) {
    let value = init;
    let added = 0;
    while (pos < n) {
      const cIdx = text.indexOf(',', pos);
      const nIdx = text.indexOf('\n', pos);
      const rIdx = text.indexOf('\r', pos);
      let end = n;
      let kind = 2;
      if (cIdx !== -1 && cIdx < end) { end = cIdx; kind = 0; }
      if (nIdx !== -1 && nIdx < end) { end = nIdx; kind = 1; }
      if (rIdx !== -1 && rIdx < end) { end = rIdx; kind = 3; }
      if (kind === 2) {
        if (end > pos) { value += text.slice(pos, end); added += end - pos; }
        pos = n;
        return { value, ended: 2, added };
      }
      if (kind === 0) {
        if (end > pos) { value += text.slice(pos, end); added += end - pos; }
        pos = end + 1;
        return { value, ended: 0, added };
      }
      if (kind === 1) {
        if (end > pos) { value += text.slice(pos, end); added += end - pos; }
        pos = end + 1;
        line += 1;
        return { value, ended: 1, added };
      }
      // kind 3: CR. CRLF is a line break, a lone CR is dropped (stray_cr).
      if (end + 1 < n && text.charCodeAt(end + 1) === 10) {
        if (end > pos) { value += text.slice(pos, end); added += end - pos; }
        pos = end + 2;
        line += 1;
        return { value, ended: 1, added };
      }
      if (end > pos) { value += text.slice(pos, end); added += end - pos; }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = end + 1;
    }
    return { value, ended: 2, added };
  }

  // Read a quoted field whose opening quote is at pos. Rare path only:
  // doubled quotes, line breaks inside, junk, or no closing quote.
  function qtd() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let segStart = pos;
    let parts = null;
    let value;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return unq('"');
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        const seg = transform(segStart, q + 1);
        if (parts === null) parts = [seg]; else parts.push(seg);
        pos = q + 2;
        segStart = pos;
        continue;
      }
      const seg = transform(segStart, q);
      if (parts === null) value = seg; else { parts.push(seg); value = parts.join(''); }
      pos = q + 1;
      break;
    }
    if (pos >= n) return { value, ended: 2 };
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; return { value, ended: 0 }; }
    if (c === 10) { pos += 1; line += 1; return { value, ended: 1 }; }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2; line += 1; return { value, ended: 1 };
    }
    const junk = unq(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Parse one record starting at pos (not inside quotes, not an empty
  // line). Returns its fields, or null when it held only stray CRs.
  // Each field is sliced between indexOf delimiters on the common path;
  // only doubled quotes, line breaks inside quotes, stray CRs, junk and
  // unterminated quotes fall back to qtd()/unq().
  function slowRecord() {
    const fields = [];
    let lastQuoted = false;
    let ended;
    do {
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        const q = text.indexOf('"', pos + 1);
        if (q === -1) {
          const f = qtd();
          fields.push(f.value);
          ended = f.ended;
          continue;
        }
        if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
          const f = qtd();
          fields.push(f.value);
          ended = f.ended;
          continue;
        }
        const nl = text.indexOf('\n', pos + 1);
        if (nl !== -1 && nl < q) {
          const f = qtd();
          fields.push(f.value);
          ended = f.ended;
          continue;
        }
        const cr = text.indexOf('\r', pos + 1);
        if (cr !== -1 && cr < q) {
          const f = qtd();
          fields.push(f.value);
          ended = f.ended;
          continue;
        }
        const value = text.slice(pos + 1, q);
        pos = q + 1;
        if (pos >= n) { fields.push(value); ended = 2; continue; }
        const c = text.charCodeAt(pos);
        if (c === 44) { fields.push(value); pos += 1; ended = 0; continue; }
        if (c === 10) { fields.push(value); pos += 1; line += 1; ended = 1; continue; }
        if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
          fields.push(value); pos += 2; line += 1; ended = 1; continue;
        }
        const junk = unq(value);
        if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
        fields.push(junk.value);
        ended = junk.ended;
      } else {
        lastQuoted = false;
        const cIdx = text.indexOf(',', pos);
        const nIdx = text.indexOf('\n', pos);
        let end = n;
        let kind = 2;
        if (cIdx !== -1 && cIdx < end) { end = cIdx; kind = 0; }
        if (nIdx !== -1 && nIdx < end) { end = nIdx; kind = 1; }
        const rIdx = text.indexOf('\r', pos);
        if (rIdx !== -1 && rIdx < end && !(kind === 1 && rIdx === end - 1)) {
          const f = unq('');
          fields.push(f.value);
          ended = f.ended;
          continue;
        }
        if (kind === 0) {
          fields.push(text.slice(pos, end));
          pos = end + 1;
          ended = 0;
        } else if (kind === 1) {
          fields.push(end > pos && text.charCodeAt(end - 1) === 13 ? text.slice(pos, end - 1) : text.slice(pos, end));
          pos = end + 1;
          line += 1;
          ended = 1;
        } else {
          fields.push(text.slice(pos, end));
          pos = n;
          ended = 2;
        }
      }
    } while (ended === 0);
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) return null;
    return fields;
  }

  while (pos < n) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: this record's line (to the next LF) holds no quote and
    // no stray CR, so it is plain fields split by commas. A quote or a
    // stray CR anywhere in the line sends the record to slowRecord().
    const eol = text.indexOf('\n', pos);
    const end = eol === -1 ? n : eol;
    const qIdx = text.indexOf('"', pos);
    let fields = null;
    if (qIdx === -1 || qIdx >= end) {
      const rIdx = text.indexOf('\r', pos);
      if (rIdx === -1 || rIdx >= end || (eol !== -1 && rIdx === end - 1)) {
        let segEnd = end;
        if (eol !== -1 && segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
        fields = text.slice(pos, segEnd).split(',');
        if (eol === -1) pos = n; else { pos = eol + 1; line += 1; }
      }
    }
    if (fields === null) {
      fields = slowRecord();
      if (fields === null) continue;
    } else if (fields.length === 1 && fields[0] === '') {
      continue;
    }

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
