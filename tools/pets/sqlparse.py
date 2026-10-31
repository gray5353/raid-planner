# MySQL 덤프에서 표 하나의 INSERT 값을 읽어 dict 목록으로
import re

def columns(sql, table):
    m = re.search(r'CREATE TABLE `%s` \((.*?)\n\)' % table, sql, re.S)
    return re.findall(r'^\s*`(\w+)`', m.group(1), re.M)

def _values(s, i):
    # s[i] == '(' 부터 튜플 목록을 읽음
    rows, row, n = [], [], len(s)
    while i < n:
        c = s[i]
        if c == '(':
            row = []; i += 1
            while True:
                while s[i] in ' \n\r\t': i += 1
                c = s[i]
                if c == "'":
                    j = i + 1; buf = []
                    while True:
                        ch = s[j]
                        if ch == '\\':
                            nx = s[j + 1]
                            buf.append({'n': '\n', 'r': '\r', 't': '\t', '0': '\0'}.get(nx, nx)); j += 2
                        elif ch == "'":
                            if s[j + 1] == "'": buf.append("'"); j += 2
                            else: break
                        else: buf.append(ch); j += 1
                    row.append(''.join(buf)); i = j + 1
                else:
                    j = i
                    while s[j] not in ',)': j += 1
                    tok = s[i:j].strip()
                    if tok == 'NULL': row.append(None)
                    else:
                        try: row.append(int(tok))
                        except ValueError:
                            try: row.append(float(tok))
                            except ValueError: row.append(tok)
                    i = j
                while s[i] in ' \n\r\t': i += 1
                if s[i] == ',': i += 1; continue
                if s[i] == ')': i += 1; break
            rows.append(row)
        elif c == ';':
            return rows, i
        else:
            i += 1
    return rows, i

def table(sql, name):
    cols = columns(sql, name)
    out = []
    pat = re.compile(r'INSERT INTO `%s`(?: \([^)]*\))? VALUES\s*' % name)
    for m in pat.finditer(sql):
        hdr = re.match(r'INSERT INTO `%s` \(([^)]*)\)' % name, m.group(0))
        cs = [c.strip(' `') for c in hdr.group(1).split(',')] if hdr else cols
        rows, _ = _values(sql, m.end())
        out.extend(dict(zip(cs, r)) for r in rows)
    return out
