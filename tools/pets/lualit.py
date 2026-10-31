# Lua 표 리터럴(숫자, 문자열, nil, true/false, {..}) 읽기
import re
_num = re.compile(r'-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?')

class P:
    def __init__(self, s): self.s, self.i = s, 0
    def ws(self):
        while self.i < len(self.s) and self.s[self.i] in ' \t\r\n': self.i += 1
    def val(self):
        self.ws(); c = self.s[self.i]
        if c == '{': return self.table()
        if c in '\'"':
            q = c; j = self.i + 1; out = []
            while self.s[j] != q:
                if self.s[j] == '\\': out.append(self.s[j + 1]); j += 2
                else: out.append(self.s[j]); j += 1
            self.i = j + 1; return ''.join(out)
        for lit, v in (('nil', None), ('true', True), ('false', False)):
            if self.s.startswith(lit, self.i): self.i += len(lit); return v
        m = _num.match(self.s, self.i)
        self.i = m.end(); t = m.group(0)
        return float(t) if ('.' in t or 'e' in t.lower()) else int(t)
    def table(self):
        self.i += 1; arr, d, n, keyed = [], {}, 0, False
        while True:
            self.ws()
            if self.s[self.i] == '}': self.i += 1; break
            if self.s[self.i] == '[':
                keyed = True
                self.i += 1; k = self.val(); self.ws(); self.i += 1  # ]
                self.ws(); self.i += 1  # =
                d[k] = self.val()
            else:
                n += 1; d[n] = self.val()
            self.ws()
            if self.s[self.i] in ',;': self.i += 1
        if not keyed:
            return [d[k] for k in range(1, len(d) + 1)]
        return d

def parse(s): return P(s).val()
