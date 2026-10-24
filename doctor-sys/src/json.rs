//! 极简 JSON：解析 + 序列化，够 doctor-sys 的请求/响应用，不追求完整 RFC。
//! 有意不引第三方 crate——整个引擎必须离线可构建（设计文档 D2：供应链风险为 0）。

use std::fmt::Write as _;

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    pub fn obj() -> Json {
        Json::Obj(Vec::new())
    }

    pub fn set(mut self, key: &str, value: Json) -> Json {
        if let Json::Obj(pairs) = &mut self {
            pairs.push((key.to_string(), value));
        }
        self
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        if let Json::Obj(pairs) = self {
            pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v)
        } else {
            None
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        if let Json::Str(value) = self { Some(value) } else { None }
    }

    pub fn as_bool(&self) -> Option<bool> {
        if let Json::Bool(value) = self { Some(*value) } else { None }
    }

    pub fn as_i64(&self) -> Option<i64> {
        if let Json::Num(value) = self {
            if value.fract() == 0.0 && value.abs() < 9.0e15 {
                return Some(*value as i64);
            }
        }
        None
    }

    pub fn as_array(&self) -> Option<&[Json]> {
        if let Json::Arr(items) = self { Some(items) } else { None }
    }

    pub fn str(value: impl Into<String>) -> Json {
        Json::Str(value.into())
    }

    pub fn num(value: i64) -> Json {
        Json::Num(value as f64)
    }

    pub fn serialize(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            Json::Null => out.push_str("null"),
            Json::Bool(true) => out.push_str("true"),
            Json::Bool(false) => out.push_str("false"),
            Json::Num(value) => write_num(*value, out),
            Json::Str(value) => write_escaped(value, out),
            Json::Arr(items) => {
                out.push('[');
                for (index, item) in items.iter().enumerate() {
                    if index > 0 { out.push(','); }
                    item.write(out);
                }
                out.push(']');
            }
            Json::Obj(pairs) => {
                out.push('{');
                for (index, (key, value)) in pairs.iter().enumerate() {
                    if index > 0 { out.push(','); }
                    write_escaped(key, out);
                    out.push(':');
                    value.write(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_num(value: f64, out: &mut String) {
    if value.is_finite() {
        if value.fract() == 0.0 && value.abs() < 9.0e15 {
            let _ = write!(out, "{}", value as i64);
        } else {
            let _ = write!(out, "{}", value);
        }
    } else {
        out.push_str("null");
    }
}

fn write_escaped(value: &str, out: &mut String) {
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn parse(input: &str) -> Result<Json, String> {
    let bytes: Vec<char> = input.chars().collect();
    let mut parser = Parser { chars: &bytes, pos: 0 };
    parser.skip_ws();
    let value = parser.value()?;
    parser.skip_ws();
    if parser.pos != parser.chars.len() {
        return Err(format!("JSON 尾部有残留内容（位置 {}）", parser.pos));
    }
    Ok(value)
}

struct Parser<'a> {
    chars: &'a [char],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn next(&mut self) -> Option<char> {
        let ch = self.peek();
        if ch.is_some() { self.pos += 1; }
        ch
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t' | '\n' | '\r')) {
            self.pos += 1;
        }
    }

    fn expect(&mut self, ch: char) -> Result<(), String> {
        if self.next() == Some(ch) { Ok(()) } else {
            Err(format!("JSON 语法错误：期望 '{}'（位置 {}）", ch, self.pos))
        }
    }

    fn value(&mut self) -> Result<Json, String> {
        match self.peek() {
            Some('{') => self.object(),
            Some('[') => self.array(),
            Some('"') => Ok(Json::Str(self.string()?)),
            Some('t') => self.literal("true", Json::Bool(true)),
            Some('f') => self.literal("false", Json::Bool(false)),
            Some('n') => self.literal("null", Json::Null),
            Some(c) if c == '-' || c.is_ascii_digit() => self.number(),
            other => Err(format!("JSON 语法错误：意外的字符 {:?}", other)),
        }
    }

    fn literal(&mut self, word: &str, value: Json) -> Result<Json, String> {
        for expected in word.chars() {
            if self.next() != Some(expected) {
                return Err(format!("JSON 语法错误：字面量 {} 不匹配", word));
            }
        }
        Ok(value)
    }

    fn object(&mut self) -> Result<Json, String> {
        self.expect('{')?;
        let mut pairs = Vec::new();
        self.skip_ws();
        if self.peek() == Some('}') { self.pos += 1; return Ok(Json::Obj(pairs)); }
        loop {
            self.skip_ws();
            let key = self.string()?;
            self.skip_ws();
            self.expect(':')?;
            self.skip_ws();
            let value = self.value()?;
            pairs.push((key, value));
            self.skip_ws();
            match self.next() {
                Some(',') => continue,
                Some('}') => break,
                other => return Err(format!("JSON 语法错误：对象里出现 {:?}（位置 {}）", other, self.pos)),
            }
        }
        Ok(Json::Obj(pairs))
    }

    fn array(&mut self) -> Result<Json, String> {
        self.expect('[')?;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(']') { self.pos += 1; return Ok(Json::Arr(items)); }
        loop {
            self.skip_ws();
            items.push(self.value()?);
            self.skip_ws();
            match self.next() {
                Some(',') => continue,
                Some(']') => break,
                other => return Err(format!("JSON 语法错误：数组里出现 {:?}（位置 {}）", other, self.pos)),
            }
        }
        Ok(Json::Arr(items))
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect('"')?;
        let mut out = String::new();
        loop {
            match self.next() {
                Some('"') => return Ok(out),
                Some('\\') => match self.next() {
                    Some('"') => out.push('"'),
                    Some('\\') => out.push('\\'),
                    Some('/') => out.push('/'),
                    Some('b') => out.push('\u{08}'),
                    Some('f') => out.push('\u{0c}'),
                    Some('n') => out.push('\n'),
                    Some('r') => out.push('\r'),
                    Some('t') => out.push('\t'),
                    Some('u') => out.push(self.unicode_escape()?),
                    other => return Err(format!("JSON 语法错误：非法转义 {:?}", other)),
                },
                Some(ch) if (ch as u32) < 0x20 => {
                    return Err("JSON 语法错误：字符串里有未转义的控制字符".into());
                }
                Some(ch) => out.push(ch),
                None => return Err("JSON 语法错误：字符串没有结束引号".into()),
            }
        }
    }

    fn hex4(&mut self) -> Result<u32, String> {
        let mut value = 0u32;
        for _ in 0..4 {
            let ch = self.next().ok_or("JSON 语法错误：\\u 转义不完整")?;
            let digit = ch.to_digit(16).ok_or("JSON 语法错误：\\u 转义不是十六进制")?;
            value = value * 16 + digit;
        }
        Ok(value)
    }

    fn unicode_escape(&mut self) -> Result<char, String> {
        let first = self.hex4()?;
        // 代理对：高代理 0xD800..0xDBFF 后面必须跟 \uDC00..\uDFFF
        if (0xD800..0xDC00).contains(&first) {
            if self.next() != Some('\\') || self.next() != Some('u') {
                return Err("JSON 语法错误：孤立的高代理".into());
            }
            let second = self.hex4()?;
            if !(0xDC00..0xE000).contains(&second) {
                return Err("JSON 语法错误：无效的代理对".into());
            }
            let combined = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00);
            char::from_u32(combined).ok_or_else(|| "JSON 语法错误：无效的码点".to_string())
        } else {
            char::from_u32(first).ok_or_else(|| "JSON 语法错误：无效的码点".to_string())
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.pos;
        if self.peek() == Some('-') { self.pos += 1; }
        while matches!(self.peek(), Some(c) if c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-')) {
            self.pos += 1;
        }
        let text: String = self.chars[start..self.pos].iter().collect();
        text.parse::<f64>().map(Json::Num).map_err(|_| format!("JSON 语法错误：非法数字 '{}'", text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_object() {
        let text = r#"{"op":"acl-read","args":{"path":"C:\\Users\\user\\桌面","deep":true,"n":-3,"list":[1,2,null]}}"#;
        let value = parse(text).unwrap();
        assert_eq!(value.get("op").and_then(|v| v.as_str()), Some("acl-read"));
        assert_eq!(value.get("args").unwrap().get("path").and_then(|v| v.as_str()), Some("C:\\Users\\user\\桌面"));
        let output = value.serialize();
        let reparsed = parse(&output).unwrap();
        assert_eq!(value, reparsed);
    }

    #[test]
    fn roundtrip_unicode_and_escapes() {
        let value = Json::obj().set("s", Json::str("a\"b\\c\nd\u{1F600}中文"));
        let text = value.serialize();
        let reparsed = parse(&text).unwrap();
        assert_eq!(value, reparsed);
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse("{").is_err());
        assert!(parse("{\"a\":}").is_err());
        assert!(parse("[1,]").is_err());
        assert!(parse("nul").is_err());
    }

    #[test]
    fn integer_extraction() {
        assert_eq!(parse("42").unwrap().as_i64(), Some(42));
        assert_eq!(parse("-7").unwrap().as_i64(), Some(-7));
        assert_eq!(parse("4.5").unwrap().as_i64(), None);
    }
}
