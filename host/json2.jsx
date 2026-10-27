// JSON for ExtendScript (ES3). Defines JSON.stringify and JSON.parse only if
// the engine has none. Written for AfterEase; parse validates its input
// before evaluating it, the same approach as Crockford's public-domain json2.

if (typeof JSON !== 'object') {
    JSON = {};
}

(function () {
    var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
    var meta = { '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r', '"': '\\"', '\\': '\\\\' };

    function quote(s) {
        escapable.lastIndex = 0;
        return '"' + s.replace(escapable, function (c) {
            if (meta[c]) {
                return meta[c];
            }
            return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
        }) + '"';
    }

    function isArray(v) {
        return Object.prototype.toString.apply(v) === '[object Array]';
    }

    function str(v) {
        var i, k, parts;
        if (v === null || v === undefined) {
            return 'null';
        }
        switch (typeof v) {
        case 'string':
            return quote(v);
        case 'number':
            return isFinite(v) ? String(v) : 'null';
        case 'boolean':
            return String(v);
        case 'object':
            parts = [];
            if (isArray(v)) {
                for (i = 0; i < v.length; i += 1) {
                    parts.push(str(v[i]));
                }
                return '[' + parts.join(',') + ']';
            }
            for (k in v) {
                if (Object.prototype.hasOwnProperty.call(v, k) && typeof v[k] !== 'function' && v[k] !== undefined) {
                    parts.push(quote(k) + ':' + str(v[k]));
                }
            }
            return '{' + parts.join(',') + '}';
        }
        return 'null';
    }

    if (typeof JSON.stringify !== 'function') {
        JSON.stringify = function (value) {
            return str(value);
        };
    }

    if (typeof JSON.parse !== 'function') {
        JSON.parse = function (text) {
            text = String(text);
            var check = text
                .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@')
                .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']')
                .replace(/(?:^|:|,)(?:\s*\[)+/g, '');
            if (/^[\],:{}\s]*$/.test(check)) {
                return eval('(' + text + ')');
            }
            throw new SyntaxError('JSON.parse: invalid JSON');
        };
    }
}());
