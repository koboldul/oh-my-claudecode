// src/hud/copilot-setup.ts
import { chmodSync as chmodSync2, existsSync as existsSync5, readFileSync as readFileSync5 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname7, join as join10, normalize as normalize3, parse as parsePath, resolve as resolve3, sep as sep3 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += "\n";
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "	";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += "\n";
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      // tokens: []{}:,
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      // strings
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      // comments
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      // numbers
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      // found a minus, followed by a number so
      // we fall through to proceed with scanning
      // numbers
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      // literals and unknown symbols
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
  CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
  CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
  CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
  CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
  CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
  CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
  CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
  CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
  CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
  CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
  CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
  CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
  CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
  CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
  CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
  CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
  CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
  CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
  CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
  CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
  CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
  CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
  CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
  CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
  CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
  CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
  CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
  CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
  CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
  CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
  CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
  CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
  CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
  CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
  CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
  CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
  CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
  CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
  CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
  CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
  CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
  CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
  CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
  CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
  CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
  CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
  CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
  CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
  CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
  CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
  CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
  CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
  CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
  CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
  CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
  CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
  CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
  CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
  CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
  CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
  CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + " ".repeat(index);
    })
  },
  "	": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\n" + "	".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "	".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r\n" + "	".repeat(index);
    })
  }
};
var supportedEols = ["\n", "\r", "\r\n"];

// node_modules/jsonc-parser/lib/esm/impl/format.js
function format(documentText, range, options) {
  let initialIndentLevel;
  let formatText;
  let formatTextStart;
  let rangeStart;
  let rangeEnd;
  if (range) {
    rangeStart = range.offset;
    rangeEnd = rangeStart + range.length;
    formatTextStart = rangeStart;
    while (formatTextStart > 0 && !isEOL(documentText, formatTextStart - 1)) {
      formatTextStart--;
    }
    let endOffset = rangeEnd;
    while (endOffset < documentText.length && !isEOL(documentText, endOffset)) {
      endOffset++;
    }
    formatText = documentText.substring(formatTextStart, endOffset);
    initialIndentLevel = computeIndentLevel(formatText, options);
  } else {
    formatText = documentText;
    initialIndentLevel = 0;
    formatTextStart = 0;
    rangeStart = 0;
    rangeEnd = documentText.length;
  }
  const eol = getEOL(options, documentText);
  const eolFastPathSupported = supportedEols.includes(eol);
  let numberLineBreaks = 0;
  let indentLevel = 0;
  let indentValue;
  if (options.insertSpaces) {
    indentValue = cachedSpaces[options.tabSize || 4] ?? repeat(cachedSpaces[1], options.tabSize || 4);
  } else {
    indentValue = "	";
  }
  const indentType = indentValue === "	" ? "	" : " ";
  let scanner = createScanner(formatText, false);
  let hasError = false;
  function newLinesAndIndent() {
    if (numberLineBreaks > 1) {
      return repeat(eol, numberLineBreaks) + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    const amountOfSpaces = indentValue.length * (initialIndentLevel + indentLevel);
    if (!eolFastPathSupported || amountOfSpaces > cachedBreakLinesWithSpaces[indentType][eol].length) {
      return eol + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    if (amountOfSpaces <= 0) {
      return eol;
    }
    return cachedBreakLinesWithSpaces[indentType][eol][amountOfSpaces];
  }
  function scanNext() {
    let token = scanner.scan();
    numberLineBreaks = 0;
    while (token === 15 || token === 14) {
      if (token === 14 && options.keepLines) {
        numberLineBreaks += 1;
      } else if (token === 14) {
        numberLineBreaks = 1;
      }
      token = scanner.scan();
    }
    hasError = token === 16 || scanner.getTokenError() !== 0;
    return token;
  }
  const editOperations = [];
  function addEdit(text, startOffset, endOffset) {
    if (!hasError && (!range || startOffset < rangeEnd && endOffset > rangeStart) && documentText.substring(startOffset, endOffset) !== text) {
      editOperations.push({ offset: startOffset, length: endOffset - startOffset, content: text });
    }
  }
  let firstToken = scanNext();
  if (options.keepLines && numberLineBreaks > 0) {
    addEdit(repeat(eol, numberLineBreaks), 0, 0);
  }
  if (firstToken !== 17) {
    let firstTokenStart = scanner.getTokenOffset() + formatTextStart;
    let initialIndent = indentValue.length * initialIndentLevel < 20 && options.insertSpaces ? cachedSpaces[indentValue.length * initialIndentLevel] : repeat(indentValue, initialIndentLevel);
    addEdit(initialIndent, formatTextStart, firstTokenStart);
  }
  while (firstToken !== 17) {
    let firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
    let secondToken = scanNext();
    let replaceContent = "";
    let needsLineBreak = false;
    while (numberLineBreaks === 0 && (secondToken === 12 || secondToken === 13)) {
      let commentTokenStart = scanner.getTokenOffset() + formatTextStart;
      addEdit(cachedSpaces[1], firstTokenEnd, commentTokenStart);
      firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
      needsLineBreak = secondToken === 12;
      replaceContent = needsLineBreak ? newLinesAndIndent() : "";
      secondToken = scanNext();
    }
    if (secondToken === 2) {
      if (firstToken !== 1) {
        indentLevel--;
      }
      ;
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 1) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else if (secondToken === 4) {
      if (firstToken !== 3) {
        indentLevel--;
      }
      ;
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 3) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else {
      switch (firstToken) {
        case 3:
        case 1:
          indentLevel++;
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 5:
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 12:
          replaceContent = newLinesAndIndent();
          break;
        case 13:
          if (numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 6:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 10:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (secondToken === 6 && !needsLineBreak) {
            replaceContent = "";
          }
          break;
        case 7:
        case 8:
        case 9:
        case 11:
        case 2:
        case 4:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else {
            if ((secondToken === 12 || secondToken === 13) && !needsLineBreak) {
              replaceContent = cachedSpaces[1];
            } else if (secondToken !== 5 && secondToken !== 17) {
              hasError = true;
            }
          }
          break;
        case 16:
          hasError = true;
          break;
      }
      if (numberLineBreaks > 0 && (secondToken === 12 || secondToken === 13)) {
        replaceContent = newLinesAndIndent();
      }
    }
    if (secondToken === 17) {
      if (options.keepLines && numberLineBreaks > 0) {
        replaceContent = newLinesAndIndent();
      } else {
        replaceContent = options.insertFinalNewline ? eol : "";
      }
    }
    const secondTokenStart = scanner.getTokenOffset() + formatTextStart;
    addEdit(replaceContent, firstTokenEnd, secondTokenStart);
    firstToken = secondToken;
  }
  return editOperations;
}
function repeat(s, count) {
  let result = "";
  for (let i = 0; i < count; i++) {
    result += s;
  }
  return result;
}
function computeIndentLevel(content, options) {
  let i = 0;
  let nChars = 0;
  const tabSize = options.tabSize || 4;
  while (i < content.length) {
    let ch = content.charAt(i);
    if (ch === cachedSpaces[1]) {
      nChars++;
    } else if (ch === "	") {
      nChars += tabSize;
    } else {
      break;
    }
    i++;
  }
  return Math.floor(nChars / tabSize);
}
function getEOL(options, text) {
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\r") {
      if (i + 1 < text.length && text.charAt(i + 1) === "\n") {
        return "\r\n";
      }
      return "\r";
    } else if (ch === "\n") {
      return "\n";
    }
  }
  return options && options.eol || "\n";
}
function isEOL(text, offset) {
  return "\r\n".indexOf(text.charAt(offset)) !== -1;
}

// node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function parseTree(text, errors = [], options = ParseOptions.DEFAULT) {
  let currentParent = { type: "array", offset: -1, length: -1, children: [], parent: void 0 };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({ type: "object", offset, length: -1, parent: currentParent, children: [] });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({ type: "property", offset, length: -1, parent: currentParent, children: [] });
      currentParent.children.push({ type: "string", value: name, offset, length, parent: currentParent });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({ type: "array", offset, length: -1, parent: currentParent, children: [] });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({ type: getNodeType(value), offset, length, parent: currentParent, value });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep4, offset, length) => {
      if (currentParent.type === "property") {
        if (sep4 === ":") {
          currentParent.colonOffset = offset;
        } else if (sep4 === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function findNodeAtLocation(root, path2) {
  if (!root) {
    return void 0;
  }
  let node = root;
  for (let segment of path2) {
    if (typeof segment === "string") {
      if (node.type !== "object" || !Array.isArray(node.children)) {
        return void 0;
      }
      let found = false;
      for (const propertyNode of node.children) {
        if (Array.isArray(propertyNode.children) && propertyNode.children[0].value === segment && propertyNode.children.length === 2) {
          node = propertyNode.children[1];
          found = true;
          break;
        }
      }
      if (!found) {
        return void 0;
      }
    } else {
      const index = segment;
      if (node.type !== "array" || index < 0 || !Array.isArray(node.children) || index >= node.children.length) {
        return void 0;
      }
      node = node.children[index];
    }
  }
  return node;
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(
            14
            /* ParseErrorCode.InvalidUnicode */
          );
          break;
        case 5:
          handleError(
            15
            /* ParseErrorCode.InvalidEscapeCharacter */
          );
          break;
        case 3:
          handleError(
            13
            /* ParseErrorCode.UnexpectedEndOfNumber */
          );
          break;
        case 1:
          if (!disallowComments) {
            handleError(
              11
              /* ParseErrorCode.UnexpectedEndOfComment */
            );
          }
          break;
        case 2:
          handleError(
            12
            /* ParseErrorCode.UnexpectedEndOfString */
          );
          break;
        case 6:
          handleError(
            16
            /* ParseErrorCode.InvalidCharacter */
          );
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(
              10
              /* ParseErrorCode.InvalidCommentToken */
            );
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(
            1
            /* ParseErrorCode.InvalidSymbol */
          );
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(
            2
            /* ParseErrorCode.InvalidNumberFormat */
          );
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
    } else {
      handleError(5, [], [
        2,
        5
        /* SyntaxKind.CommaToken */
      ]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [
          2,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [
        2
        /* SyntaxKind.CloseBraceToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [
          4,
          5
          /* SyntaxKind.CommaToken */
        ]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [
        4
        /* SyntaxKind.CloseBracketToken */
      ], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}

// node_modules/jsonc-parser/lib/esm/impl/edit.js
function setProperty(text, originalPath, value, options) {
  const path2 = originalPath.slice();
  const errors = [];
  const root = parseTree(text, errors);
  let parent = void 0;
  let lastSegment = void 0;
  while (path2.length > 0) {
    lastSegment = path2.pop();
    parent = findNodeAtLocation(root, path2);
    if (parent === void 0 && value !== void 0) {
      if (typeof lastSegment === "string") {
        value = { [lastSegment]: value };
      } else {
        value = [value];
      }
    } else {
      break;
    }
  }
  if (!parent) {
    if (value === void 0) {
      throw new Error("Can not delete in empty document");
    }
    return withFormatting(text, { offset: root ? root.offset : 0, length: root ? root.length : 0, content: JSON.stringify(value) }, options);
  } else if (parent.type === "object" && typeof lastSegment === "string" && Array.isArray(parent.children)) {
    const existing = findNodeAtLocation(parent, [lastSegment]);
    if (existing !== void 0) {
      if (value === void 0) {
        if (!existing.parent) {
          throw new Error("Malformed AST");
        }
        const propertyIndex = parent.children.indexOf(existing.parent);
        let removeBegin;
        let removeEnd = existing.parent.offset + existing.parent.length;
        if (propertyIndex > 0) {
          let previous = parent.children[propertyIndex - 1];
          removeBegin = previous.offset + previous.length;
        } else {
          removeBegin = parent.offset + 1;
          if (parent.children.length > 1) {
            let next = parent.children[1];
            removeEnd = next.offset;
          }
        }
        return withFormatting(text, { offset: removeBegin, length: removeEnd - removeBegin, content: "" }, options);
      } else {
        return withFormatting(text, { offset: existing.offset, length: existing.length, content: JSON.stringify(value) }, options);
      }
    } else {
      if (value === void 0) {
        return [];
      }
      const newProperty = `${JSON.stringify(lastSegment)}: ${JSON.stringify(value)}`;
      const index = options.getInsertionIndex ? options.getInsertionIndex(parent.children.map((p) => p.children[0].value)) : parent.children.length;
      let edit;
      if (index > 0) {
        let previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      } else if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty + "," };
      }
      return withFormatting(text, edit, options);
    }
  } else if (parent.type === "array" && typeof lastSegment === "number" && Array.isArray(parent.children)) {
    const insertIndex = lastSegment;
    if (insertIndex === -1) {
      const newProperty = `${JSON.stringify(value)}`;
      let edit;
      if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        const previous = parent.children[parent.children.length - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else if (value === void 0 && parent.children.length >= 0) {
      const removalIndex = lastSegment;
      const toRemove = parent.children[removalIndex];
      let edit;
      if (parent.children.length === 1) {
        edit = { offset: parent.offset + 1, length: parent.length - 2, content: "" };
      } else if (parent.children.length - 1 === removalIndex) {
        let previous = parent.children[removalIndex - 1];
        let offset = previous.offset + previous.length;
        let parentEndOffset = parent.offset + parent.length;
        edit = { offset, length: parentEndOffset - 2 - offset, content: "" };
      } else {
        edit = { offset: toRemove.offset, length: parent.children[removalIndex + 1].offset - toRemove.offset, content: "" };
      }
      return withFormatting(text, edit, options);
    } else if (value !== void 0) {
      let edit;
      const newProperty = `${JSON.stringify(value)}`;
      if (!options.isArrayInsertion && parent.children.length > lastSegment) {
        const toModify = parent.children[lastSegment];
        edit = { offset: toModify.offset, length: toModify.length, content: newProperty };
      } else if (parent.children.length === 0 || lastSegment === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: parent.children.length === 0 ? newProperty : newProperty + "," };
      } else {
        const index = lastSegment > parent.children.length ? parent.children.length : lastSegment;
        const previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else {
      throw new Error(`Can not ${value === void 0 ? "remove" : options.isArrayInsertion ? "insert" : "modify"} Array index ${insertIndex} as length is not sufficient`);
    }
  } else {
    throw new Error(`Can not add ${typeof lastSegment !== "number" ? "index" : "property"} to parent of type ${parent.type}`);
  }
}
function withFormatting(text, edit, options) {
  if (!options.formattingOptions) {
    return [edit];
  }
  let newText = applyEdit(text, edit);
  let begin = edit.offset;
  let end = edit.offset + edit.content.length;
  if (edit.length === 0 || edit.content.length === 0) {
    while (begin > 0 && !isEOL(newText, begin - 1)) {
      begin--;
    }
    while (end < newText.length && !isEOL(newText, end)) {
      end++;
    }
  }
  const edits = format(newText, { offset: begin, length: end - begin }, { ...options.formattingOptions, keepLines: false });
  for (let i = edits.length - 1; i >= 0; i--) {
    const edit2 = edits[i];
    newText = applyEdit(newText, edit2);
    begin = Math.min(begin, edit2.offset);
    end = Math.max(end, edit2.offset + edit2.length);
    end += edit2.content.length - edit2.length;
  }
  const editLength = text.length - (newText.length - end) - begin;
  return [{ offset: begin, length: editLength, content: newText.substring(begin, end) }];
}
function applyEdit(text, edit) {
  return text.substring(0, edit.offset) + edit.content + text.substring(edit.offset + edit.length);
}

// node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError2) {
  ScanError2[ScanError2["None"] = 0] = "None";
  ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind2) {
  SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
  SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
  SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
  SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
  SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parse2 = parse;
var ParseErrorCode;
(function(ParseErrorCode2) {
  ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}
function modify(text, path2, value, options) {
  return setProperty(text, path2, value, options);
}
function applyEdits(text, edits) {
  let sortedEdits = edits.slice(0).sort((a, b) => {
    const diff = a.offset - b.offset;
    if (diff === 0) {
      return a.length - b.length;
    }
    return diff;
  });
  let lastModifiedOffset = text.length;
  for (let i = sortedEdits.length - 1; i >= 0; i--) {
    let e = sortedEdits[i];
    if (e.offset + e.length <= lastModifiedOffset) {
      text = applyEdit(text, e);
    } else {
      throw new Error("Overlapping edit");
    }
    lastModifiedOffset = e.offset;
  }
  return text;
}

// src/installer/index.ts
import { join as join8, dirname as dirname5, resolve as resolve2, isAbsolute as isAbsolute2, basename as basename3 } from "path";

// src/installer/hooks.ts
import { join as join2, dirname } from "path";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { homedir as homedir2 } from "os";

// src/utils/config-dir.ts
import { join, normalize, parse as parse3, sep } from "path";
import { homedir } from "os";
function stripTrailingSep(p) {
  if (!p.endsWith(sep)) {
    return p;
  }
  return p === parse3(p).root ? p : p.slice(0, -1);
}
function getClaudeConfigDir() {
  const home = homedir();
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!configured) {
    return stripTrailingSep(normalize(join(home, ".claude")));
  }
  if (configured === "~") {
    return stripTrailingSep(normalize(home));
  }
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return stripTrailingSep(normalize(join(home, configured.slice(2))));
  }
  return stripTrailingSep(normalize(configured));
}

// src/installer/hooks.ts
function getPackageDir() {
  if (typeof __dirname !== "undefined") {
    return join2(__dirname, "..");
  }
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname2 = dirname(__filename);
    return join2(__dirname2, "..", "..");
  } catch {
    return process.cwd();
  }
}
function loadTemplate(filename) {
  const templatePath = join2(getPackageDir(), "templates", "hooks", filename);
  if (!existsSync(templatePath)) {
    return "";
  }
  return readFileSync(templatePath, "utf-8");
}
function isWindows() {
  return process.platform === "win32";
}
function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}
function isDefaultClaudeConfigDir() {
  return normalizePath(getClaudeConfigDir()) === normalizePath(join2(homedir2(), ".claude"));
}
function quoteCommandPath(path2) {
  return `"${path2.replace(/"/g, '\\"')}"`;
}
function buildHookCommand(filename) {
  if (isWindows()) {
    return `node ${quoteCommandPath(join2(getClaudeConfigDir(), "hooks", filename).replace(/\\/g, "/"))}`;
  }
  if (isDefaultClaudeConfigDir()) {
    return `node "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/hooks/${filename}"`;
  }
  return `node ${quoteCommandPath(join2(getClaudeConfigDir(), "hooks", filename).replace(/\\/g, "/"))}`;
}
var KEYWORD_DETECTOR_SCRIPT_NODE = loadTemplate(
  "keyword-detector.mjs"
);
var STOP_CONTINUATION_SCRIPT_NODE = loadTemplate(
  "stop-continuation.mjs"
);
var PERSISTENT_MODE_SCRIPT_NODE = loadTemplate("persistent-mode.mjs");
var CODE_SIMPLIFIER_SCRIPT_NODE = loadTemplate("code-simplifier.mjs");
var SESSION_START_SCRIPT_NODE = loadTemplate("session-start.mjs");
var POST_TOOL_USE_SCRIPT_NODE = loadTemplate("post-tool-use.mjs");
var HOOKS_SETTINGS_CONFIG_NODE = {
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("keyword-detector.mjs")
          }
        ]
      }
    ],
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("session-start.mjs")
          }
        ]
      }
    ],
    PreToolUse: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("pre-tool-use.mjs")
          }
        ]
      }
    ],
    PostToolUse: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("post-tool-use.mjs")
          }
        ]
      }
    ],
    PostToolUseFailure: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("post-tool-use-failure.mjs")
          }
        ]
      }
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("persistent-mode.mjs")
          }
        ]
      },
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand("code-simplifier.mjs")
          }
        ]
      }
    ]
  }
};

// src/lib/version.ts
import { readFileSync as readFileSync2, existsSync as existsSync2, lstatSync, realpathSync } from "fs";
import { join as join3, dirname as dirname2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
function getRuntimePackageVersion() {
  try {
    const __filename = fileURLToPath2(import.meta.url);
    const __dirname2 = dirname2(__filename);
    for (let i = 0; i < 5; i++) {
      const candidate = join3(__dirname2, ...Array(i + 1).fill(".."), "package.json");
      try {
        const pkg = JSON.parse(readFileSync2(candidate, "utf-8"));
        if (pkg.name && pkg.version) {
          return pkg.version;
        }
      } catch {
        continue;
      }
    }
  } catch {
  }
  try {
    const __filename = fileURLToPath2(import.meta.url);
    const pathMatch = __filename.match(/oh-my-claudecode\/(\d+\.\d+\.\d+[^/]*)\//);
    if (pathMatch?.[1]) {
      return pathMatch[1];
    }
  } catch {
  }
  return "unknown";
}

// src/utils/paths.ts
import { join as join4, dirname as dirname3 } from "path";
var PLUGIN_ROOT_REQUIREMENTS = [
  join4("hooks", "hooks.json"),
  join4("scripts", "run.cjs"),
  "scripts"
];
var OCCUPIED_CODES = new Set(
  process.platform === "win32" ? ["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR", "EPERM", "EACCES"] : ["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"]
);
var STALE_THRESHOLD_MS = 10 * 60 * 1e3;

// src/lib/paths.ts
var OMC_PLUGIN_MARKETPLACE_SLUG = "omc";
var OMC_PLUGIN_PACKAGE_NAME = "oh-my-claudecode";
var OMC_PLUGIN_CACHE_REL = `plugins/cache/${OMC_PLUGIN_MARKETPLACE_SLUG}/${OMC_PLUGIN_PACKAGE_NAME}`;
var OMC_PLUGIN_MARKETPLACE_REL = `plugins/marketplaces/${OMC_PLUGIN_MARKETPLACE_SLUG}`;

// src/lib/hud-wrapper-template.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join5 } from "node:path";
function buildHudWrapper(packageDir) {
  return readFileSync3(
    join5(packageDir, "scripts", "lib", "hud-wrapper-template.txt"),
    "utf8"
  );
}

// src/lib/worktree-paths.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { closeSync, existsSync as existsSync3, lstatSync as lstatSync2, mkdirSync, openSync, readFileSync as readFileSync4, readSync, realpathSync as realpathSync2, readdirSync, writeFileSync, unlinkSync, statSync } from "fs";
import { resolve, normalize as normalize2, relative, sep as sep2, join as join6, isAbsolute, basename, dirname as dirname4 } from "path";
import { pathToFileURL } from "url";
var canonicalWorkingDirectoryRoots = /* @__PURE__ */ new WeakMap();
var worktreePathRenderScope = new AsyncLocalStorage();
function callerVisibleTrustedRootLabel(trustedRoot) {
  const label = basename(trustedRoot);
  return label.length > 0 ? label : "current repository";
}
function attachCanonicalWorkingDirectoryRoots(target, providedRoot, trustedRoot) {
  canonicalWorkingDirectoryRoots.set(target, { providedRoot, trustedRoot });
}
function canonicalRootAliases(root) {
  if (root.length === 0) {
    return [];
  }
  const aliases = /* @__PURE__ */ new Set([root]);
  try {
    aliases.add(pathToFileURL(root).href);
  } catch {
  }
  try {
    const real = realpathSync2(root);
    aliases.add(real);
    aliases.add(pathToFileURL(real).href);
  } catch {
  }
  if (sep2 === "\\") {
    aliases.add(root.replaceAll("\\", "/"));
  }
  return [...aliases].sort((a, b) => b.length - a.length);
}
function redactCanonicalRoots(text, providedRoot, trustedRoot) {
  let redacted = text;
  const roots = [...canonicalRootAliases(providedRoot), ...canonicalRootAliases(trustedRoot)].sort((a, b) => b.length - a.length);
  for (const root of roots) {
    redacted = redacted.split(root).join("<redacted>");
  }
  return redacted;
}
function redactErrorStack(stack, providedRoot, trustedRoot) {
  const newline = stack.includes("\r\n") ? "\r\n" : "\n";
  const lines = stack.split(/\r?\n/);
  if (lines.length <= 1) {
    return stack;
  }
  const [header, ...frames] = lines;
  return [header, ...frames.map((frame) => redactCanonicalRoots(frame, providedRoot, trustedRoot))].join(newline);
}
var ForeignWorkingDirectoryError = class extends Error {
  callerLabel;
  constructor(providedRoot, trustedRoot, callerLabel) {
    super(
      `workingDirectory '${callerLabel}' belongs to a different repository than '${callerVisibleTrustedRootLabel(trustedRoot)}' and was not used. Cross-repository access is not permitted; pass a path inside the current repository or start the session there.`
    );
    this.name = "ForeignWorkingDirectoryError";
    this.callerLabel = callerLabel;
    attachCanonicalWorkingDirectoryRoots(this, providedRoot, trustedRoot);
    Object.defineProperty(this, "stack", {
      value: redactErrorStack(this.stack ?? `${this.name}: ${this.message}`, providedRoot, trustedRoot),
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      callerLabel: this.callerLabel
    };
  }
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    return this.stack ?? `${this.name}: ${this.message}`;
  }
};

// src/utils/user-skill-compat.ts
import { basename as basename2, join as join7 } from "path";
var CLAUDE_SKILLS_DIR = join7(getClaudeConfigDir(), "skills");
var OMC_LEARNED_DIR = join7(CLAUDE_SKILLS_DIR, "omc-learned");

// src/installer/claude-md-transaction.ts
var CLAUDE_MD_IMPORT_START = "<!-- OMC:IMPORT:START -->";
var CLAUDE_MD_IMPORT_END = "<!-- OMC:IMPORT:END -->";
var CLAUDE_MD_IMPORT_BLOCK = `${CLAUDE_MD_IMPORT_START}
@CLAUDE-omc.md
${CLAUDE_MD_IMPORT_END}
`;

// src/installer/historical-agent-ownership.ts
var HISTORICAL_AGENT_OWNERSHIP = [
  { filename: "analyst.md", byteLength: 3539, sha256: "7508ad221b63a4195449a1d21fb82f79bc1bb1b18cc27cdbf9687050c738c645", gitBlob: "f5a6e73195c81488e10fdc2b0fdc0a61207e223f", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "analyst.md", byteLength: 4832, sha256: "2971ca1421c128b2ca6f569807860594f79da22ecb6cd1829cb678e8f362d631", gitBlob: "4332a1d2c65ae0f1a22ed6c72f57fa2ee8fe3c21", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.10" },
  { filename: "analyst.md", byteLength: 5431, sha256: "986259201ddbe054ad2248fec503ebbcee0a308fea54359715461aee30e007bd", gitBlob: "83bb4622e6ccb10cf1f3d8f7ff04fa352873a3ff", firstReleaseTag: "v4.1.11", lastReleaseTag: "v4.3.3" },
  { filename: "analyst.md", byteLength: 5434, sha256: "3f8d3717635e09f1533bcd55a541cd685eb022187a22ceb97672cff3f14a532f", gitBlob: "3b3e92cb03c1705543bee6d034943c75bceef7fd", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.8.2" },
  { filename: "analyst.md", byteLength: 5443, sha256: "b3a979c108514cf0b6b06dae7885f7fcbfd8f32208c7c4df7ea63becce66ad16", gitBlob: "c97e30968cb2a9dfa1aacc352874a7d42408f5d1", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "analyst.md", byteLength: 5432, sha256: "0df623596ef938c98780432fd851c0a18cab06bfc18a22dff5d54b1a196e2a18", gitBlob: "d4223b10c8466ed95b4eb3afed849fe5d9bccb7a", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "analyst.md", byteLength: 5565, sha256: "d61db30524426a5812432262a57fc8aa04021def3ef60870cdad64b2304a9f90", gitBlob: "a975598d3b0140fb732229e9ddc4189ec8d8cf2f", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.14.6" },
  { filename: "analyst.md", byteLength: 6317, sha256: "b08225a9bd349c84697a63b9e7e4e1016c01dafec5b3337bb95f70fce495ceb1", gitBlob: "fe2f523e108993aaffeb6e8ab8d8bbf268fa0eff", firstReleaseTag: "v4.14.7", lastReleaseTag: "v4.15.7" },
  { filename: "api-reviewer.md", byteLength: 5152, sha256: "fbffc73e2e84f4733b6b7af0445442e4ede9df7e65711c43d8fccf5bd5bde58c", gitBlob: "7350c070a21f09bcdca6a2f9e95389e92d1fa754", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "architect-low.md", byteLength: 2245, sha256: "57f68fe06802314af773fe82ecfeb1f56dc5d96971a260fa2fb79a3c26edb2b3", gitBlob: "1ef95d589bb7e0bc00796b2a9e99aa79f750a12b", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "architect-medium.md", byteLength: 4011, sha256: "eeb4fa3919cb5eee5d90776cc3531f85cb69a43928d500397b7ceea16bb69230", gitBlob: "d7b22e7ea9ac86f84c125d15afdee2595120a2d2", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "architect.md", byteLength: 9972, sha256: "2e27438266dd9b5adc9dda1463032738144b697532dc959a9da4ee35c2fab8f9", gitBlob: "0dfa116d390c638bc3be972e218f6de6df927636", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "architect.md", byteLength: 5445, sha256: "3423c63221d23af7a33aae6cce598f0c59c8ca039b8628c0bd40d972966ac8c0", gitBlob: "1f1593731cc262bbd8a7070987bd6f10d188fb82", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.18" },
  { filename: "architect.md", byteLength: 5953, sha256: "83e20105ca868873ceda0e8f2eb26398b8b60770d0d24d51893163dcbaf1e1b1", gitBlob: "cc0227bdb98e825bccbaa32679fc2d88746b1701", firstReleaseTag: "v4.2.0", lastReleaseTag: "v4.3.3" },
  { filename: "architect.md", byteLength: 5955, sha256: "4336126e0f5e83d52fb3146fead98469fe8a0afd32e32c51b98b4c453459fdbc", gitBlob: "30821e5b7c5b5d1369bae6b79f3130b4cd6ed732", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.3.4" },
  { filename: "architect.md", byteLength: 5846, sha256: "3c865d6fbf364b92ec33f3151803a4b7b9dd3a6a1a664fe599de5ef7be6fb570", gitBlob: "377de6ae92d9a03e515d5261e12d06766d258fb2", firstReleaseTag: "v4.4.0", lastReleaseTag: "v4.4.5" },
  { filename: "architect.md", byteLength: 6877, sha256: "fbac3c92794169a9a902c8a86877a77cf1a8ab6e82b4f26fe4159f516d881faa", gitBlob: "08d588daf546a5b8291807b7a1e392a8ffed1a23", firstReleaseTag: "v4.5.0", lastReleaseTag: "v4.8.2" },
  { filename: "architect.md", byteLength: 6886, sha256: "d47c9fce4ec9510121cbcf653e3c73db58d0c5dc9393588ba75dde862d3034d5", gitBlob: "de7f54e7db65096d9f8bdc425b990f9f376e812b", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "architect.md", byteLength: 6875, sha256: "c0a1081e607a333bb8ee3d7b097b7504eb3ad46b2d351dfccb72097cda24cf50", gitBlob: "cba04ad1c23f1a795f5b62b0a15d08d56ad94c33", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "architect.md", byteLength: 7008, sha256: "67c585938f2faa3384f6d88a65ef93932e027ec058b28ca12d9d15068370a44c", gitBlob: "c69fa8bcde0a9be39b37e8a20b5208123e8184cf", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.14.5" },
  { filename: "architect.md", byteLength: 7685, sha256: "054854158e573b95efc0022bf4ebdd1c947d02e4cbf0f820d8a37bb155e104b7", gitBlob: "1eefa8170204fe1a903e80e7f17e70f6fdb74fe9", firstReleaseTag: "v4.14.6", lastReleaseTag: "v4.15.7" },
  { filename: "build-fixer-low.md", byteLength: 1926, sha256: "4607140848cd41b1f1d62eb077202014d2b467dcc15a412353101fdedb1f8c00", gitBlob: "bcfa371c263bf4b1493ca1f856ef907b4bef2bd1", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "build-fixer.md", byteLength: 7244, sha256: "48020fac37ec37370151f7aa36d1eb2a84b73de61b5ab41efb00aac5038a0eba", gitBlob: "e025ee8c7085b261d24f21b2865a6a1350b1c79a", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "build-fixer.md", byteLength: 4544, sha256: "cac4a3306ff35f8d01c7173d436c351267accb95b4cdf92658240d46950de093", gitBlob: "e8e34458a508a8982f4fee6c453d4946d0eb6ffc", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.3" },
  { filename: "build-fixer.md", byteLength: 4555, sha256: "af080383b633f6871618f98b76678a8753aec11b5cb5688197495d17748a0c52", gitBlob: "f2e79fa048558cd1aefdd348c254cad299cb7981", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.7.7" },
  { filename: "code-reviewer-low.md", byteLength: 1903, sha256: "1903808be31c3a6db653cc2e0ab4af6a5838cc91365c950e7504e61686269125", gitBlob: "42b41b4cd615519889d712de9374080a772582eb", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "code-reviewer.md", byteLength: 6049, sha256: "31a8cac2f6245bc83cb23c572c78c5098b79a96e7751aa98a692b4ebc4da30ad", gitBlob: "d27eae057282c062d583244378d4d8a4ba5eab1f", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "code-reviewer.md", byteLength: 5126, sha256: "f50ab36aaf3ba2d0c688bd0890b7a8679aafaddceb5f4fd05e9c8209df501e16", gitBlob: "19e76d2fe57b3d764fb0d1087b856dfdff4326b2", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.18" },
  { filename: "code-reviewer.md", byteLength: 5634, sha256: "5391cf0065c167272d90a784b1938434443fb3b3d2b7c4d1b189b1303c445f3c", gitBlob: "f698de23b84b680cc9960fe2a8bc215f90649e18", firstReleaseTag: "v4.2.0", lastReleaseTag: "v4.3.0" },
  { filename: "code-reviewer.md", byteLength: 6138, sha256: "7acc7993d3bfd67cefd76c1b7597624068d147cf16d75a08d80ea78436227972", gitBlob: "64a8907e37ac4775e372beb85428f805beaee722", firstReleaseTag: "v4.3.1", lastReleaseTag: "v4.3.3" },
  { filename: "code-reviewer.md", byteLength: 6149, sha256: "b430cfb8f88d95c5f34195131e24df9b1ea300be7d4e5d7ad65f1040e7889567", gitBlob: "aedeb4cbbabde728281dbfd505085220c142085b", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.3.4" },
  { filename: "code-reviewer.md", byteLength: 6035, sha256: "164b987e66b33aebb625893137357dc864dc00ce378481adc9e575201340e57d", gitBlob: "7b4f5884b1d850b0bc28153e0a9d3ea41b3d606f", firstReleaseTag: "v4.4.0", lastReleaseTag: "v4.7.7" },
  { filename: "code-reviewer.md", byteLength: 11795, sha256: "972728c0e4ce00639cc3b2364a6366bcac21af074e74e069a5cddc49ebb82235", gitBlob: "0f8f30910814d148c6d87536830d9e2278e6db09", firstReleaseTag: "v4.7.8", lastReleaseTag: "v4.7.8" },
  { filename: "code-reviewer.md", byteLength: 12046, sha256: "c38b6d24149e4a1c57129b68be7343f80b237e58da4c4c49c73f9888b1c93ec8", gitBlob: "90ed95fdf18079ca8f58a407cf9ca31fcc9fbc77", firstReleaseTag: "v4.7.9", lastReleaseTag: "v4.8.2" },
  { filename: "code-reviewer.md", byteLength: 12055, sha256: "9a26e24f530c60e310274279087bb159578282fabf19d19bef208b24b844ad6f", gitBlob: "dd7d4fb54b601c3b6c18a83e13e41887b149e560", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "code-reviewer.md", byteLength: 12044, sha256: "42ea7e51311cffe7b7bbf9dda386b1debb2c48f4c03509b8bd02e43cf52c251c", gitBlob: "59ef9f9d6bedd65e363b612bd2729f241ec70c1e", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "code-reviewer.md", byteLength: 12177, sha256: "192c5c219bdf652516d8264caf03e0f72c075aede85b81c974815e6177db2469", gitBlob: "5590f872aad02595999358b4270f73f0aa9e73d8", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.13.5" },
  { filename: "code-reviewer.md", byteLength: 14463, sha256: "3e06d0421a5290340020a1f7904d144a0ea2a6a61ab8d8d41863cf37319d7d74", gitBlob: "f97ab6c31c14fd15da422a2f431c84bd6d51a7c0", firstReleaseTag: "v4.13.6", lastReleaseTag: "v4.14.5" },
  { filename: "code-reviewer.md", byteLength: 15169, sha256: "0194fe714d4dcd61cf049322ae1f737deda5e59356eba4faca51ad38d025e9fc", gitBlob: "1dea64c1089f5e50422304ad565c065c3a6168f8", firstReleaseTag: "v4.14.6", lastReleaseTag: "v4.15.7" },
  { filename: "code-simplifier.md", byteLength: 4403, sha256: "ad0bbcaeb000ac91b24906c160c309880c034d8b38e19cce625f09d4d3bab74f", gitBlob: "01676fe234df9e3d69bbd27af5da6ea40f79c139", firstReleaseTag: "v4.3.0", lastReleaseTag: "v4.3.3" },
  { filename: "code-simplifier.md", byteLength: 4414, sha256: "11952957123feb8d129b41e6cfaaab40ac018a71accdf25da3233c5c738a659d", gitBlob: "3130e378afbad6a1d90221f59f0b1634f7aef685", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.8.2" },
  { filename: "code-simplifier.md", byteLength: 4423, sha256: "5f30bef8a39fe76ac129cd31f5dcce5558c67151c3e76fce4675454c69aa2936", gitBlob: "15f53ab58f8ea5751662afdae6462e038019c5e0", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "code-simplifier.md", byteLength: 4412, sha256: "44a797ce76724e94821e6434cf9d578c6775ddd9eb233a3b4c071e2cb5f7f0cc", gitBlob: "d13c0859f7f2358835d75579a3584aa48fc29856", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.15.7" },
  { filename: "critic.md", byteLength: 6014, sha256: "5cb78048dbedbc37e6c915551596a21a2d4c2007e927be215d9b1260956bcc98", gitBlob: "2b1c94be413b2fc7062a60f8a57655a09d674b35", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "critic.md", byteLength: 5132, sha256: "7b22771fa5cdf27b586fc96e700b370eced37eeb097c5981c1f02a07b19be6c7", gitBlob: "dc1a2992664af1bb578f1a2337dc1a869e8850b5", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.3" },
  { filename: "critic.md", byteLength: 5143, sha256: "573a6e27c82dad59b16e89f47aaeb27e9dfc9155b645ef397980a176398c0ea4", gitBlob: "8632674a1b0c9e5ac8bc0c104f5f68a9c85de3f0", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.4.5" },
  { filename: "critic.md", byteLength: 6568, sha256: "ec453839d45cbc8c0b29e2a4081b9e6df162c0e32d1a77900d12a0bab5772f14", gitBlob: "3c0e2fdbf26f49e9fc861a2c4e078b7f8cc4fce8", firstReleaseTag: "v4.5.0", lastReleaseTag: "v4.7.7" },
  { filename: "critic.md", byteLength: 21440, sha256: "7a2571011570e0f56e5c059fc9ad13dde7808f71b69ab5f5337d03d5037d6dd3", gitBlob: "e3d0fc5dfdc2c0b6f51f3d4671f7e8188e79511a", firstReleaseTag: "v4.7.8", lastReleaseTag: "v4.8.2" },
  { filename: "critic.md", byteLength: 21449, sha256: "e552d8ca193166d1101fdcac7d51aa066de037ddff0987b7478bd4ec8ec665e0", gitBlob: "2db0f437824db9664640f116c0311d81e6965de1", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "critic.md", byteLength: 21438, sha256: "e9a7adc94895f2905735bb437f2b747c9eab258f2f72bd68066d294c70dd80b8", gitBlob: "6c42962e2afeea6437b3f12eeb3f75e463f896e2", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "critic.md", byteLength: 21571, sha256: "a6d716ab88db4a53377c1efa79942d9540aeca6e48a36dfa542b636681729779", gitBlob: "a0004ff231adc80a0c814cc53b73be56df98c8bc", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.14.5" },
  { filename: "critic.md", byteLength: 22285, sha256: "7ac22331649f07805eca351e784629520a831d6a7ff8596628c66e6d4703b072", gitBlob: "e697f33d01c1db27cebebca4b9f1c12a541fa4fe", firstReleaseTag: "v4.14.6", lastReleaseTag: "v4.15.7" },
  { filename: "debugger.md", byteLength: 5476, sha256: "454542081471de9a6abb99db54b640d0e13b9846849e954358cf9716636cc07f", gitBlob: "074a5f313b01d037c3cae3b6d3fb872bd5cb969b", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "debugger.md", byteLength: 5413, sha256: "05355b54d0e75079c0762d9dffe70da10844cefc6df83320dbe2e83ab95f4a73", gitBlob: "4713a8039d9debda27d733bd5c8f3d969f05b597", firstReleaseTag: "v4.3.1", lastReleaseTag: "v4.3.3" },
  { filename: "debugger.md", byteLength: 5424, sha256: "f1a71c40b3287bd33789bc37ea345dde91c2b56e4d3d3b179936d2d96e7752b7", gitBlob: "998a707f221135198e7a2278a8400a11392571e9", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.7.7" },
  { filename: "debugger.md", byteLength: 9057, sha256: "2d66952cd3adf85a10b5d49960bea8d27792ad707e8ea509144661db2443b2f7", gitBlob: "67517332d4bbb2c010c3fc771db7539af7c084e2", firstReleaseTag: "v4.7.8", lastReleaseTag: "v4.8.2" },
  { filename: "debugger.md", byteLength: 9066, sha256: "ea83d73afa5d668fd39d6610ea10ec867e02af9f9df9107a85d4de6b49700a47", gitBlob: "1596a0f18c517f5e1da1e5f1f210e8ad3f5ef6d3", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "debugger.md", byteLength: 9055, sha256: "e39b54b437720fd044cfb4b8c05d260741ba875ac5fa9459ab6aa3d0272bdb05", gitBlob: "d38cf27a5bc83f875313a8ef21276774e3ce4d66", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "debugger.md", byteLength: 9188, sha256: "1eb6caa1ced9dbead61b4a971f8fbc050fb32b5c669ad1291c5723a2ae8afa5f", gitBlob: "f53c46b4753b95145b2e10007d2cf0d2a9247271", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.14.6" },
  { filename: "debugger.md", byteLength: 9897, sha256: "14714f2a4671411e006c604291e0551cc38cc45c18e0665de2f30ef6996047c6", gitBlob: "904b667802399e03e4791858e31a38c23bf0a732", firstReleaseTag: "v4.14.7", lastReleaseTag: "v4.15.7" },
  { filename: "deep-executor.md", byteLength: 11518, sha256: "d69c8d02219bf96fec51313754a52d6c9e24be24a147c97952eb16422a82de06", gitBlob: "d96c3bc82dcb73ad3d75e734971560d3edfa7080", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "deep-executor.md", byteLength: 6069, sha256: "7ab2a7c26f5ed860ac015e5bbd13af8762979d83c995baa86a6a6a34d771d981", gitBlob: "432f6bedea76e968df701741e38010628b29d04f", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.18" },
  { filename: "deep-executor.md", byteLength: 6577, sha256: "46b65f7fd3cff8bf6e22d61e37e92c33e98f9c0f9139498cd154bccba58f4f28", gitBlob: "4f828fd1c85400c3d4516b93876488139fc8b9e2", firstReleaseTag: "v4.2.0", lastReleaseTag: "v4.2.7" },
  { filename: "deep-executor.md", byteLength: 6586, sha256: "084f040b7e50f255b695b839f272b8942e14bd907459df5ba42f26f2606cc15c", gitBlob: "3eb1721beb2c258004d134ab62b1f4d44e104090", firstReleaseTag: "v4.2.8", lastReleaseTag: "v4.3.3" },
  { filename: "deep-executor.md", byteLength: 6597, sha256: "60d0bcb3ca1ee03529509f857f969512cfbdc584033bce3a1a87a256f0b66ec7", gitBlob: "56b6607b79b08fd7c9bddf23df5ac24b62e9b541", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.3.4" },
  { filename: "deep-executor.md", byteLength: 6488, sha256: "392b91cb10baacdd876953c0b95f445bd6e3379e5d190b60bcb59ede30f761ca", gitBlob: "39b0dec823c8742179407ed1e4e8356808151e15", firstReleaseTag: "v4.4.0", lastReleaseTag: "v4.7.7" },
  { filename: "dependency-expert.md", byteLength: 5489, sha256: "ecb794b20ca9ce6b4ddd59c3d2f71c85492ea69141a8cb6d0a517b2f9fed2c5a", gitBlob: "4010a44001c73c99131168f124e8c114372251f4", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "designer-high.md", byteLength: 5931, sha256: "eecd781a3e473b249312493089ac4f14acd7ab714c9cd6ce48433641b10ca35c", gitBlob: "e9e76a3eba694efe490c725226c1fc8fa3685e87", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "designer-low.md", byteLength: 3313, sha256: "0225d48fda441738d6814bb46cdd033ec5cf6c1c8c115788e6738c4fa1dae9c0", gitBlob: "d9a64d2d812fd2dfed8a662b562d7e99ab1a079b", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "designer.md", byteLength: 4571, sha256: "037d2d6ca6d672cf93ffa3ab2a392203b3cb00faa13f369a9eafab9e647c6104", gitBlob: "9f85f1c046dceeaec4582d1e3c17fbac6f783106", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "designer.md", byteLength: 5458, sha256: "49f775dada948357b0dd5c6729adba7d8018a20a3229e5d8c1ef7e78488891b4", gitBlob: "fa451c264e1f2a8f5eb8e3685179c372fee445c3", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.18" },
  { filename: "designer.md", byteLength: 5960, sha256: "f4a31543b5a89834425778ad4dc18f8ba5017e8b07518918a4f2ea98ed8de2fb", gitBlob: "30dedaef6cff5e1aa19eb44bf6c473ab7cd21e39", firstReleaseTag: "v4.2.0", lastReleaseTag: "v4.3.3" },
  { filename: "designer.md", byteLength: 5971, sha256: "c5ace68ab4cf450e10d3141c54e2843e1a54edac4f9fa149d204e548a63ff100", gitBlob: "57de0b6046e46009c69ded9e092f3865bfebc19f", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.3.4" },
  { filename: "designer.md", byteLength: 5759, sha256: "f49ee8a8f7a462ec3344d74788ffd95f5eca15ddb285c0ce22e7dfed35183256", gitBlob: "c07252185c236232eb64e92a3f3132664d3608aa", firstReleaseTag: "v4.4.0", lastReleaseTag: "v4.8.2" },
  { filename: "designer.md", byteLength: 5768, sha256: "a300143947e297e45bd4b00a3d07b859475ba93691eff0270db414abaa7e26c5", gitBlob: "c0e4dbce6293adbb76c7eb642483616907858809", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "designer.md", byteLength: 5757, sha256: "4bbf0f7298beb56a381cf1a2f4265fda40a1ad3f9e665af31785efe3b6b838e6", gitBlob: "a7813997f46ae4d491fa7245154d861bca7b5f49", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "designer.md", byteLength: 5890, sha256: "de5a1df9885e72997d692c5ad4d4a66cec9da303862fe118a49dbb4cd6558e32", gitBlob: "780377a69c9452ba24c43c35375636b678991692", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.13.5" },
  { filename: "designer.md", byteLength: 9627, sha256: "61e77f70753e09e87d2ef4e549c4459c1572cab3eddd72e2a0a430169bb256c8", gitBlob: "d23f95782f8f207f4aacf18c0f44f78ee03f458b", firstReleaseTag: "v4.13.6", lastReleaseTag: "v4.15.7" },
  { filename: "document-specialist.md", byteLength: 4687, sha256: "06a876282a9b0a3df9f64eab4021643ce72b00d18a65afe66af026754595d45e", gitBlob: "a0abff1b62cfd7414d9af86665c08be25730942d", firstReleaseTag: "v4.2.8", lastReleaseTag: "v4.3.3" },
  { filename: "document-specialist.md", byteLength: 4698, sha256: "2ef90b21eb4c278384859ae149bd8db07dfc3a93f2ce2f49347f37dffdd2c1f0", gitBlob: "a1c7c2fce3326e3e3b6a4b60215a66924f18799f", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.7.6" },
  { filename: "document-specialist.md", byteLength: 5012, sha256: "301664b041188dda651e3c3f15ce9b8468c9f7096e5c3d6ff75c0610cf612ada", gitBlob: "41eae6251f76834ab3ebc32cbacc39c1ecc5804e", firstReleaseTag: "v4.7.7", lastReleaseTag: "v4.7.9" },
  { filename: "document-specialist.md", byteLength: 7183, sha256: "77bb82c1191ede4212acbb498ca98fb3a44049cfd08727583d82c5d1d04a7124", gitBlob: "238bf6afb0a2f4f52f9ec57266a9cd25d9e6ebe1", firstReleaseTag: "v4.7.10", lastReleaseTag: "v4.8.2" },
  { filename: "document-specialist.md", byteLength: 7192, sha256: "4897f3fac88e5be2fa46b9f93c578a864fb31bdc911ca6d7735017ad8eb529ab", gitBlob: "07a8f0c0b54858a7202d7bd84b9fcd62b2c63abc", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "document-specialist.md", byteLength: 7181, sha256: "1b306df45efb601d53e1b527e0f5dfa12594d0ab1e81832946a512a814230da3", gitBlob: "01b785a1cd973458c6441edb8b75751380badd36", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "document-specialist.md", byteLength: 7310, sha256: "d6f01d210e5e74bb8e6f534657fd77eb39ca5feebc2bb451088cbe6b7790fd74", gitBlob: "79215e89a82f5c1902758b6f695fa8089dfb56f5", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.15.7" },
  { filename: "executor-high.md", byteLength: 7350, sha256: "fcf788dd78c638cb36a0eec2742d2659f42d34fa26d567369636f14edfe6fb57", gitBlob: "04b88ed82c8c94af11121f2a97d7e63a3ac7a03b", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "executor-low.md", byteLength: 2503, sha256: "3599a83ee126ddcb89f0ec1db581a0b18cdf4ebe20e6772a61c3a66c0447b238", gitBlob: "5749ed21344c4934ca33e81ad8077a9385a91f0b", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "executor.md", byteLength: 4137, sha256: "7dddf0b285c82fbedfb260b8d6965db0035d803e5ebe6209f43fe2d3e8a21849", gitBlob: "4c665f9a515b18bb786ba7e6053ff4ed00161500", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "executor.md", byteLength: 4859, sha256: "90b54f845257fd373396b1babe4e1a197b107d50bceb93dd4e1062ddb628b011", gitBlob: "19eb61916842d30fb9e710372f6f775f58b3f5aa", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.18" },
  { filename: "executor.md", byteLength: 5266, sha256: "3c2ec2c771aa86698c9dfe4f902aa47475446f84b87b191552a6e0d46c3c4ba2", gitBlob: "b8c293d9fd2bed71cc680ee00bedc36ce971efe0", firstReleaseTag: "v4.2.0", lastReleaseTag: "v4.3.3" },
  { filename: "executor.md", byteLength: 5277, sha256: "89a0d768528192bea1791f824116f07d6e8befa3ab17473dc4f30a3a9262c3f8", gitBlob: "e490e54e2a720985aacb9e54aa9c87ffba973416", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.3.4" },
  { filename: "executor.md", byteLength: 5168, sha256: "baa9f75d91e72fd1596ea6e1cf232ed2a6b54427e3b43f5c8bf6ee60544935c2", gitBlob: "61528d077b26fe1530f038ba26a7ebca8cf2defe", firstReleaseTag: "v4.4.0", lastReleaseTag: "v4.7.7" },
  { filename: "executor.md", byteLength: 7432, sha256: "83df010c3ae92adf91fbdcefacd9383d407f30745bb4863ebc995d38d29f9cc5", gitBlob: "f5992eba462f3539bd663e3cce2f3a89208b57ee", firstReleaseTag: "v4.7.8", lastReleaseTag: "v4.8.2" },
  { filename: "executor.md", byteLength: 7441, sha256: "598fbcde9f3a8c2e5a39f9213ad8a0dd6674af848c34f97cf61886d79aa1ea14", gitBlob: "10aa2e0742807093e0cff6fc2bdb14d9e12b9855", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "executor.md", byteLength: 7430, sha256: "f467a68cf7636bb9faceedf4d5f07321ebaecc4d127f94947a436c5091421d5b", gitBlob: "92cb6dd6fdfab3beee911c91c4e7276fbe0efcff", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "executor.md", byteLength: 7563, sha256: "996bfa5ed0b560285c0ca020e75f02a60a4ef97062ecaac7b285699f57711865", gitBlob: "54c79972b7fdf7c6189daf3e2820ab358506bc49", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.15.7" },
  { filename: "explore-high.md", byteLength: 7728, sha256: "984d9fea47c45d54d47ebddb10cf5b8647f7667906c280400eb7ecfcd6c9eee3", gitBlob: "c535510a0e0e541d82d184be4211ae5e971aaf2d", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "explore-medium.md", byteLength: 4072, sha256: "8d60817e76cb7cc78eec5979b3007dcc4325af42e036dd4d539d031d5b1bc862", gitBlob: "fd2da7f453787061e6661b5d060302bd301539dc", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "explore.md", byteLength: 3164, sha256: "cce28c6147f00e841b6582f96c0593302523a51dfa38e1b19e01f5ace91f5d9f", gitBlob: "2aa5e2f04ab0a4b45c60926e85db78279b3bb3a0", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "explore.md", byteLength: 5260, sha256: "dcda623eae48287e7cd3efffdf578d48896afeb74ac27c50911669c1805c65b1", gitBlob: "c3639d424aa168d7a7f60b4fddc16a620078adc8", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.2.3" },
  { filename: "explore.md", byteLength: 6530, sha256: "f3a83dc262731c091e92503311d9e410472059a6a755d94261431d71a779c64a", gitBlob: "4ac0f53985b3095fb4f1cdf4d400df6faa288024", firstReleaseTag: "v4.2.4", lastReleaseTag: "v4.3.3" },
  { filename: "explore.md", byteLength: 6541, sha256: "3a34c91f7050ee8574a16e68f71b706f8b13ec2fadb39ed0ffd3ffffd8762419", gitBlob: "4c69af979c80d1f7155d4520265317beae533312", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.7.6" },
  { filename: "explore.md", byteLength: 6981, sha256: "47a4571bce3b7a18497a7cf8192024c314de9d86740b34ffcb50ee6c0eeb0873", gitBlob: "8a7a941f208db5199470421db7dd9291b776f405", firstReleaseTag: "v4.7.7", lastReleaseTag: "v4.8.2" },
  { filename: "explore.md", byteLength: 7401, sha256: "953af89c36968f6d735dbccc5ba494bb35872498f432e833235111e197a04693", gitBlob: "d527d2ab73674f697226d4b6187f61269a135987", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "explore.md", byteLength: 7390, sha256: "c75bad9c35876f30f273e855a1807cd76e0f362cf97872852370cb4da08d78c6", gitBlob: "86fd24c1c6e6a688fda6d0188499d6a76e588945", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "explore.md", byteLength: 7523, sha256: "a629637a20d2848e459c581057da0d258125e03eb243d8c984e98a0ed6636bcb", gitBlob: "519c61a2340c06d4373e9217c607e695f22652f4", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.15.7" },
  { filename: "git-master.md", byteLength: 3830, sha256: "7c51a5706ce8c828848293e03e6a5de491a9c09e487802c6b534a66bb33c2635", gitBlob: "b8784cfe636ce41b9b66433c9b4de06fbda68ef8", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "git-master.md", byteLength: 4660, sha256: "7238f26e331a35557f011b82f9b5a330130ceb20f0f76149121a52e4f302ae25", gitBlob: "a2a0eff138d781e6d90d84420cace53a9f65a2eb", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.3" },
  { filename: "git-master.md", byteLength: 4671, sha256: "73832c6808664765b73b2dd12d4b44b9fefc250831225cb154c843f50a89d927", gitBlob: "0d7a932695797a60c0eb036e8528f049e8f43f68", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.8.2" },
  { filename: "git-master.md", byteLength: 4680, sha256: "ee6dfffd47afcd06cfeb2756d9eb8ebbb36ac92083f1c04c2e9a2782ae96fbe9", gitBlob: "20830fe3ab69d8b7a2d255518f8bb6db65abd696", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "git-master.md", byteLength: 4669, sha256: "488cbd45d8a9d12597a1645969d6ff9041004e0a30dc08961a7e77aea1f9c1fd", gitBlob: "e1fded0b68999e4be736dda367d7bd7e04cd3365", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.12.0" },
  { filename: "git-master.md", byteLength: 4683, sha256: "097df0c648a60a3336daa89706c83722bce0ee1a7b7e3a367835e831c2433239", gitBlob: "dc0e65378c54fae99ce3358f0e39dafe8ae0f7d5", firstReleaseTag: "v4.12.1", lastReleaseTag: "v4.13.2" },
  { filename: "git-master.md", byteLength: 4816, sha256: "40fbc2b31b1b1e0f957dcc7343e8b3a9e92422927c868db68d46cbb07f4abb58", gitBlob: "313b3eaca08e56097e5334a7432b91373e7ebcde", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.15.7" },
  { filename: "harsh-critic.md", byteLength: 10040, sha256: "38d7365a2b0d4f17beee68a0438a4182d18ef9ca3bc74b8230d8a3d8a39f05d8", gitBlob: "913ed89ade29866f01bd2d90db7ef5cea4090b21", firstReleaseTag: "v4.6.1", lastReleaseTag: "v4.6.7" },
  { filename: "harsh-critic.md", byteLength: 16942, sha256: "1808d4fb454525036a51f1834bfa3f93259fe34c9ea9b25d9532c792d619067a", gitBlob: "2bf16a6d9f42cf91e16ff16fe1f3f717d9313689", firstReleaseTag: "v4.7.0", lastReleaseTag: "v4.7.1" },
  { filename: "harsh-critic.md", byteLength: 18824, sha256: "cc143eb707eca4993cbc63668dae3cacd62c80c11b09bdb928e5e70d6efa11d2", gitBlob: "4df066efe9701e279a3e70e5d273e0977d6e9448", firstReleaseTag: "v4.7.2", lastReleaseTag: "v4.7.7" },
  { filename: "information-architect.md", byteLength: 11899, sha256: "d538a4905e0cbfff57eae73061981dda3b1a03b2faf1ffd7b717fc4162b66b1b", gitBlob: "a66a9ca9fa8810c04b56fccfdd5c424536abbd83", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "performance-reviewer.md", byteLength: 5376, sha256: "c47749dbebd12958e2eefa1ac0eafb3e81dc3a8ce35e95fdbd936497ad46bdb9", gitBlob: "e27e0cd510c6059709ae4050b06ea0d359936b43", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "planner.md", byteLength: 12966, sha256: "ea8a64a6b168464c0090d91c9382f77c6f5bc177475de5513f52a3a0328ea87c", gitBlob: "6de233df1e19cfb51392fd6a2cad0e299e763d79", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "planner.md", byteLength: 5841, sha256: "fc2d772232f38ac01d34e06a60aea535819c7e620fbf01d7d9e251a3be35ea38", gitBlob: "87d6907d5be67e06e60e83e1598c877f8fe609f4", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.10" },
  { filename: "planner.md", byteLength: 6632, sha256: "53d040e23441cd5e29b635c2f42bfd3530151979fd233c69003d97ee2a03108a", gitBlob: "7c207a11df34015cb24e20b7a0099082c5c3fc0b", firstReleaseTag: "v4.1.11", lastReleaseTag: "v4.2.7" },
  { filename: "planner.md", byteLength: 6641, sha256: "aeb4e933ee7171643741eed2b19dd81eac14999cf2d6d0389a51cc71ce16764c", gitBlob: "5303ee52844f007fe0c361802ef7e9a97a0722c8", firstReleaseTag: "v4.2.8", lastReleaseTag: "v4.3.3" },
  { filename: "planner.md", byteLength: 6623, sha256: "128e90605aecb8f50847a2ff08d367d9e59008fb1770c127e36d6d109ced85f3", gitBlob: "3ff2465faed5761e95a3341ee7eebc0414a43376", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.4.5" },
  { filename: "planner.md", byteLength: 8487, sha256: "e92ad321aa66b146aa8116476b2d3060f41d016bc1ba81ebd59b072a9bc2f8d5", gitBlob: "12af6aec319522ddb12acb890ce68bb0a5afd1f3", firstReleaseTag: "v4.5.0", lastReleaseTag: "v4.8.2" },
  { filename: "planner.md", byteLength: 8496, sha256: "e9a47fc7cbdf15398f87d959ab47223f8c5429e44d55c59beb490675728ff21c", gitBlob: "fdf97cf5a29f16f1692edc2cd29020e5ce1e14bb", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "planner.md", byteLength: 8485, sha256: "ac766a3ea38b84e1931cce2374d25c680830a3e36d4ca5fe84d3f57ff818aa71", gitBlob: "c9ed9f57b488f051cda40036c69bcc0f6b2437a3", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "planner.md", byteLength: 8618, sha256: "20186e7bb9cc8298838cf2bd7caf187c79d9b9cb8ed941a9600b9c98454a09e5", gitBlob: "d6850ceab6fb5aa1ef8edeafc5b83682d7d02fb5", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.15.7" },
  { filename: "product-analyst.md", byteLength: 13212, sha256: "9645acd18b8a645095a80e0bc92a4c4f5000904468426703de6bd204569fc19b", gitBlob: "aa294db8a01f8c06ab8db4da99e62c4066dfb9b5", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "product-manager.md", byteLength: 9900, sha256: "f2bc3809e4e2009bb148ab4f9ae73d1034b1b76a346bcf76c16e1aa89e22d40c", gitBlob: "b88efcd2919eb4bbd4e828218d7ffa4a1ee6bad7", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "qa-tester-high.md", byteLength: 3481, sha256: "b6b9049fcb95a826dd18a341b8405febb7ce3bb41da0ce7601f2a1634196f92f", gitBlob: "e416eba7d64749e405c819d19cb419b12e683a8f", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "qa-tester.md", byteLength: 5781, sha256: "c00813d028fadc820a97b619efc5bb78d7721222608a3c50417c894aba4e64aa", gitBlob: "acd730c56088daf9251e517d42248b64f5e09f40", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "qa-tester.md", byteLength: 5073, sha256: "de9b01c276b5aaf169e889e4316d80b3c9dc856dd22ae9d19cddab75dc4d3e57", gitBlob: "6a7364fc775e4bb4f701f7149b41969ce264a4ad", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.3" },
  { filename: "qa-tester.md", byteLength: 5084, sha256: "f4dca79c8269aef8a95bc2a62598b24afb0e749ef44f80bb8a90c85cb017771e", gitBlob: "6423da37f6237d94ab540a329f8156f56c9614a1", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.8.2" },
  { filename: "qa-tester.md", byteLength: 5093, sha256: "b6cfa0dcc7d37bc3962381afbe853801bed5ec25ed8898ccb1b6368de3b096bc", gitBlob: "c43c3613ed33310fa5e27a636dbf5916c11ea8e7", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "qa-tester.md", byteLength: 5082, sha256: "2f808a58afc484440aff1d683341d71249f075e5b4ab6f3ec562ff83f3bb666d", gitBlob: "8a3e01707a6ec63e0675c55dee0ff6004aec7ec8", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "qa-tester.md", byteLength: 5215, sha256: "f34416b12bfc9c4071ee034c4e481733334b05e8e42d604cd84d579c557832ce", gitBlob: "968677a0daa644e5d4bfe33d5afba472872d76ea", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.15.7" },
  { filename: "quality-reviewer.md", byteLength: 5388, sha256: "18ecad81bd3e2af46e03981d6d12e98ff744ba61b7a0c0552676a41b1502f49a", gitBlob: "5e0a47a068a091a87c420c13bd57843d47b419a9", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.18" },
  { filename: "quality-reviewer.md", byteLength: 5896, sha256: "78eacd535f0b4eacd019cc615e2ca05f190c9386ff4878c6e2a72bfa7d09a78f", gitBlob: "908bbcd1f72ddee38b4ea45c140f9f384282e2d2", firstReleaseTag: "v4.2.0", lastReleaseTag: "v4.3.0" },
  { filename: "quality-reviewer.md", byteLength: 8630, sha256: "d90ef5cfc12bc412400ccbf18003ef2ea11497d6e59e5a05db8832ed09cfdf7a", gitBlob: "f92202e5b42e3350611ce39015094f85b33f9ead", firstReleaseTag: "v4.3.1", lastReleaseTag: "v4.3.3" },
  { filename: "quality-reviewer.md", byteLength: 8641, sha256: "8b949dbf776499ed2f61f8b9d9202caf74712857de04c12d5d6563ca0def6184", gitBlob: "4afa7cd79db5346e7ca9059fd4482e52a9d9bdc5", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.3.4" },
  { filename: "quality-reviewer.md", byteLength: 8535, sha256: "98f44f332f9fe951c9aac52fd34ad4e1183cf0e4fcce05c3d7493ca5919b9c14", gitBlob: "99812ffe67e72692aa1a6b72404945c7bd20ac53", firstReleaseTag: "v4.4.0", lastReleaseTag: "v4.7.7" },
  { filename: "quality-strategist.md", byteLength: 9211, sha256: "b67c4aadb5d669f88100a70f2755435b09cb405ed732c666db4df34d1e5e3dc8", gitBlob: "d07c77d41adc4b1e992182af66f1f69c3aeb86f7", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "researcher-low.md", byteLength: 2313, sha256: "42c6d5edc118b73c0d2f63cd9108be4c93be9f85fd3b4b3808e8fd2dd1076cb2", gitBlob: "ec9e58182d6b2fdcb33069685053d60d4dda3e91", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "researcher.md", byteLength: 1803, sha256: "9d2e37cd75f0b2c116f864d55366e53b0abcff04013fd14e4a26a1de903cde83", gitBlob: "475266b6548c09681194e783910028e909be4052", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "researcher.md", byteLength: 4681, sha256: "44df8878c71b3c46d3d29850cb127202cda699743b7854b31b90052661e8a976", gitBlob: "d5a398a06dabbdf7342d29748ec38ffc5291aee4", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.2.7" },
  { filename: "scientist-high.md", byteLength: 37441, sha256: "45bd55bf11f9b70b78672c0ae1b690af1a3f37c16de7420410c72c947219f09b", gitBlob: "982a6098c392ae68a00fec4a31315dfd73b0a6ff", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "scientist-low.md", byteLength: 6193, sha256: "36439720677aca15a6c5346113cef85150624ae2b561ce87f7ecc6a62f624c61", gitBlob: "9cd8c858106750676f9c599564d89bbf3bb09f94", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "scientist.md", byteLength: 36550, sha256: "a83691961b62ffb7ff05c37e0401bb186a0c65ac65a4e9cea5d2d726333c9050", gitBlob: "43cb1ad8ffd9b846c674ea9ddb238f96fbdfe11b", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "scientist.md", byteLength: 5357, sha256: "e9cf952be76a644f9dd693ab089fa39dbfc19b8d199a90603517ae7d645dd7a3", gitBlob: "f680515b2b83e73357d17b80f6294434cf30d904", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.2.7" },
  { filename: "scientist.md", byteLength: 5366, sha256: "17c8454bc6967a4bdd9feb66dd63736710cf6e54b08678b36248e6546c9bc946", gitBlob: "c837fdb858d3f4fa97000df8132a4aa33137f934", firstReleaseTag: "v4.2.8", lastReleaseTag: "v4.3.3" },
  { filename: "scientist.md", byteLength: 5377, sha256: "0eec3f270c1a8df330f00f01ce34c3c4b46a4f976ea0e5ec5913ede19602e514", gitBlob: "28580fc2da873437978eb358179a92bd6b21c04f", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.8.2" },
  { filename: "scientist.md", byteLength: 5386, sha256: "90a217575d1ec6750c1ad42d1b3cde89b79f9caf170c1c0104aedcbb58596ab5", gitBlob: "289f4a10ae0d0442ee60c118e308c9ffcf1f98bd", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "scientist.md", byteLength: 5375, sha256: "f99bf14660866bce2fe8ef9fcb33be630aa398ebfd6e332684fcd97552a678dd", gitBlob: "a420695a6309d1dd82f880991b30f541066451de", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "scientist.md", byteLength: 5508, sha256: "cbe304e00b334c4c6035325542e522f66f8671b631dbc5fff4db9383bbefcd23", gitBlob: "7414274edb22b6f0242d08e02a539658ebd15958", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.15.7" },
  { filename: "security-reviewer-low.md", byteLength: 2201, sha256: "d57c41f1e1320b3a83397780595e9a060069edfed6ff69774335d5b7ebf4e2f9", gitBlob: "c6600d08ba24ad6d034f0fc6dd12b91548189401", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "security-reviewer.md", byteLength: 6667, sha256: "57d92316f8610e52ef6793adc3c77296927f649bc1610429f35d0d236e26b3e5", gitBlob: "f3d4306ec7b7b5ad69c621d473c1ee4ad61008d6", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "security-reviewer.md", byteLength: 6147, sha256: "1156268997a8b5373995f36c853d3dd24c475a1b8444d21504ab59cc4d5ce849", gitBlob: "52242a753fc0daaa0bfda16e39dc4354be09aad5", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.18" },
  { filename: "security-reviewer.md", byteLength: 6655, sha256: "8218fc08e6dc9a514362323efcf869e84144bd8053e2923fd4c7970415dcde5a", gitBlob: "319e731457736aa8569f6339d172eded7a734978", firstReleaseTag: "v4.2.0", lastReleaseTag: "v4.3.0" },
  { filename: "security-reviewer.md", byteLength: 6602, sha256: "020b1e3450654ea4005e572fa66a2e91a7b6db1c64875bead93aefd7e2404980", gitBlob: "3128cf48d5301c48d5f37180c9391fca50fb06f0", firstReleaseTag: "v4.3.1", lastReleaseTag: "v4.3.3" },
  { filename: "security-reviewer.md", byteLength: 6613, sha256: "845741d632d40bbcfad56edbbb56eb8305bc3f7bb63e82eca70e28764ae6f053", gitBlob: "4e0b456cdcd4350544c5f9820ffd1b893194504a", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.3.4" },
  { filename: "security-reviewer.md", byteLength: 6503, sha256: "8769911a585ea2966c4fac875e2d536bc41ad8d023e429c0c910862c7deabc7f", gitBlob: "d4c1e42a75bf2d3957a5857cc051f4346a07d04b", firstReleaseTag: "v4.4.0", lastReleaseTag: "v4.7.7" },
  { filename: "security-reviewer.md", byteLength: 9014, sha256: "f3aeaed2e0195c91f7f4890118b7ae4f294c6933f3ed49cdb93f428165d35162", gitBlob: "92a7cf7c3a632cf93cd19f9105c6a6f628902cf0", firstReleaseTag: "v4.7.8", lastReleaseTag: "v4.8.2" },
  { filename: "security-reviewer.md", byteLength: 9023, sha256: "07d3980188922142f36d8e84c60ec3db0445a18548ea2bc70f609f4ceecfbfcb", gitBlob: "0f370a68b94e54ac186e7a8a645c8e91352b41d8", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "security-reviewer.md", byteLength: 9012, sha256: "11aeb0a4184206ca25a8fc1bd19824191d0062f1bca3c5f9f11bb157fd83b9b5", gitBlob: "76deaf6c2e087ea96a9e193a26f878af41dd19d0", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "security-reviewer.md", byteLength: 9145, sha256: "78e9fbd98057fd3ed113171957038df8096cc1cbe7d0870452ced2f3200e2200", gitBlob: "750501c59a9f129bc2be19ff102ddbd1567db628", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.14.5" },
  { filename: "security-reviewer.md", byteLength: 9818, sha256: "ede4e0af76067168dc3aecacffc73f330a950bf79ec187471950cb2d985de8e9", gitBlob: "c36f17c1cb74950e24f2f161458ff3d4cd58950b", firstReleaseTag: "v4.14.6", lastReleaseTag: "v4.15.7" },
  { filename: "style-reviewer.md", byteLength: 4430, sha256: "084bade0aadd36ddb0b220038ad599047bc187f698025d250a8ed3f3b8db7785", gitBlob: "6d301d91d448475e36ef8f7d13f217dea62a5e2d", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "tdd-guide-low.md", byteLength: 1922, sha256: "43b2d38c219bf5992c2cb79521e38d2da117b25466a0ac46b54dbf9de72b84ad", gitBlob: "a68d747f0dccdd677b4155e4e6da6ec9ae797344", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "tdd-guide.md", byteLength: 8236, sha256: "bbb6c65fa5375f6c6da6127c25a2340603d7b8df06ea3c874eaab24162f66154", gitBlob: "47c297e8968abfd0f83b303bc6ebabe9e28e1f7e", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "test-engineer.md", byteLength: 5147, sha256: "251c3cbf0dc27e518df950c0a6861905de1a4a537b5ae0b601ecad91f5e40fa9", gitBlob: "3ad8da1576ba79770b0af7ef49961479fbace2ea", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.1.18" },
  { filename: "test-engineer.md", byteLength: 5655, sha256: "804f615d83e6601af11473b0544392f5c35261aa916c1b8b1a1ddf216ed5948d", gitBlob: "b7bcf786691890c8e4d90bfa6ae554bb8795b048", firstReleaseTag: "v4.2.0", lastReleaseTag: "v4.3.0" },
  { filename: "test-engineer.md", byteLength: 5606, sha256: "1a38e356ad44133b9895ed4787e4b9a8c3a2b13c6e7cfbbb147b5237604b44a2", gitBlob: "d11a4743878e8bd8e64d8b8cb519c53baa252907", firstReleaseTag: "v4.3.1", lastReleaseTag: "v4.3.3" },
  { filename: "test-engineer.md", byteLength: 5617, sha256: "2c3d5793b7b5c7958e9953b97f07cef48e4c3ec524a4219adc1565f55b403f2e", gitBlob: "bc12d1d675c47f8d9b3d2db5a45a73b53cb7c423", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.3.4" },
  { filename: "test-engineer.md", byteLength: 5507, sha256: "4bb0f20f5f0e60ea92d5f7a8b46fe3f6c1dd8513362117813cf983559966c5a5", gitBlob: "5183e5b7b2e3f1318250915ef08d0639262fa727", firstReleaseTag: "v4.4.0", lastReleaseTag: "v4.7.7" },
  { filename: "test-engineer.md", byteLength: 6493, sha256: "1e0021206f87f59027f54180633eff7a5795d84d34b86146c8436d0b7512838b", gitBlob: "cd698af6aca64e6118e16b5225770096e26064ee", firstReleaseTag: "v4.7.8", lastReleaseTag: "v4.8.2" },
  { filename: "test-engineer.md", byteLength: 6502, sha256: "07c9cf50f6ceee2deddbe5e7f7908a95795a9e6991746d8e101fed333481a959", gitBlob: "9f7c1e60ff0520143f46755a8208fb1b9404e673", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "test-engineer.md", byteLength: 6491, sha256: "a107d60370ca5fb59e624d4341a2ad7d7d4b9b0f062d04ecec1f8f9618b3aa9b", gitBlob: "964f7227101d3adac264759aba7d454c7a663daa", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "test-engineer.md", byteLength: 6624, sha256: "6edcaf059b9cccc7eaa1ddde385bd23467d3e0ec798d0de153a3b6f03e5de939", gitBlob: "0ad8b2ecd975365fdc36d252677a14ee24309b64", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.15.7" },
  { filename: "tracer.md", byteLength: 11153, sha256: "85f84acf02f3a5bf7215c458235eeed3cea21fcb6cbbed15d411d8efbc7f2455", gitBlob: "44758846869323a1a1fea13778b372e6d1b4d52c", firstReleaseTag: "v4.8.0", lastReleaseTag: "v4.8.2" },
  { filename: "tracer.md", byteLength: 11162, sha256: "0388ac6d0d82d55c5e12ac42f9029fdc3e187dcac356f7797a2df4ba9f2dc9ee", gitBlob: "942b7400ab7143075696a1447604fc1cd558c0ae", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "tracer.md", byteLength: 11151, sha256: "43b87391b40d13670bd71bc9f145566c26471051c8a212a87077d51a2ea2acae", gitBlob: "62fd5922f832145a3cf9fc6521752d5fdff68900", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "tracer.md", byteLength: 11284, sha256: "17f21f7a43395bbb4b245122d9a3d0c5449d58d3054422858336f01318b7e816", gitBlob: "bbd69e0b76d16c2ce288e5416a6a4e5140264d34", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.14.6" },
  { filename: "tracer.md", byteLength: 12013, sha256: "948875149f833317423510482ac7c5f7b7fad845422986e87fdcd30c440232d7", gitBlob: "aea63f909d0a5ac8115a9e7e094e2aa7da9737bd", firstReleaseTag: "v4.14.7", lastReleaseTag: "v4.15.7" },
  { filename: "ux-researcher.md", byteLength: 12113, sha256: "0c8b96124a6ce8fd875e0781c178bd64a715f58e1dced2551317d4b849e61a6f", gitBlob: "10088f785f700118af6176ac8c214c097612d494", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "verifier.md", byteLength: 5225, sha256: "69295a5c3ee2088002328a4a677e179f62746796bea8168672b01873be4fa263", gitBlob: "b3187f6e30bddbaea78670cb68affff310758d5d", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "verifier.md", byteLength: 5180, sha256: "0609a092d3a338c0be559446f077635396e1f41d544b13b7bb03498b42debd1d", gitBlob: "08139669a0ad17ed7da3b25808d2617dc5a9b5ae", firstReleaseTag: "v4.3.1", lastReleaseTag: "v4.3.3" },
  { filename: "verifier.md", byteLength: 5191, sha256: "579b12a672c38b816cbe5926cefc3f2736f80439769f956f13a143bbf5670d03", gitBlob: "d44edaef38596e6aa5e0a08372374dc6b370f296", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.7.8" },
  { filename: "verifier.md", byteLength: 5430, sha256: "ceb8bf2c88ae4a2fcafc1660a239e9b5315ac52f2b04731b2230b2b76625c9ad", gitBlob: "af736ffbddffa6b319251375cc1a93b2cf2ccf84", firstReleaseTag: "v4.7.9", lastReleaseTag: "v4.8.2" },
  { filename: "verifier.md", byteLength: 5806, sha256: "cb365987c06a8941eef8cb99272d18db6df3a683e53aa5a511f86eb7c0e7e1d9", gitBlob: "cfa1c15aa2c256978ceef355f9d44ad80ef6bd90", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "verifier.md", byteLength: 5795, sha256: "b3989f4c2d1b6b6b2cc2817013005a3ba9fe2688b1c8040638b4b218022a19ab", gitBlob: "a54f08966962417020acbe54619e3c05d2b0f96e", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "verifier.md", byteLength: 5928, sha256: "aaff548cc93e96f411137495935733dbd768bc894b306fb01d78478da690dc8e", gitBlob: "a3ceb374176471f646a2479f3aae9d02fd8ccd75", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.14.6" },
  { filename: "verifier.md", byteLength: 6643, sha256: "8560d3a986199809497866a4fedbf9417cecca7cb670d0ba4aad70a7891e9a25", gitBlob: "aef6c20563c783639f5024426cb46c62badcbdd0", firstReleaseTag: "v4.14.7", lastReleaseTag: "v4.15.7" },
  { filename: "vision.md", byteLength: 1448, sha256: "6b749e4cd185a5b46678e253d714b5b3891f0b5be08aa9badfa565d284f550c0", gitBlob: "ebc0880d5e049b2632f89de00ed9669eb730c747", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "vision.md", byteLength: 3895, sha256: "6a71b35f94c2ba0b167546d76f6476123e94f2693e3fb118c00ccad26218df6e", gitBlob: "fab1612e86f8836b101ce83c7346dd195d23344f", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.0" },
  { filename: "writer.md", byteLength: 6914, sha256: "03f93c34c28637c58fb8c64f0af1291bed75f1eddc8d58817b7d94a95d0b52ec", gitBlob: "5b70b5412907175f28c8d6899a62eb3f1b6ac72e", firstReleaseTag: "v4.0.0", lastReleaseTag: "v4.0.10" },
  { filename: "writer.md", byteLength: 3984, sha256: "8c0ff3173cab8d3ab1a8f6fef1fbb509655711b82a0f163d85f38546caf9936f", gitBlob: "5884e9d95146d567abd30cea17a89ffd256467aa", firstReleaseTag: "v4.1.0", lastReleaseTag: "v4.3.3" },
  { filename: "writer.md", byteLength: 3995, sha256: "8fe1491421050c13285858dfb42c0e214d7ecebaaaa7bf62232609a144085bb3", gitBlob: "83370a7b17678f88f08c2214140be6add5370192", firstReleaseTag: "v4.3.4", lastReleaseTag: "v4.7.8" },
  { filename: "writer.md", byteLength: 4255, sha256: "855596d8c3c5f95ce39a905c94d48163c896c502a8af9af272508218c85bced3", gitBlob: "3aea07bfea9958f4672ad5aa90fead3f9681c8f1", firstReleaseTag: "v4.7.9", lastReleaseTag: "v4.8.2" },
  { filename: "writer.md", byteLength: 4264, sha256: "93f935811a29c8368dc8f5aa168622bd9a5bf7e4ad692ff16b9b996044f76bef", gitBlob: "84276bb10e2777d4fed43b395680eb00d4dd10da", firstReleaseTag: "v4.9.0", lastReleaseTag: "v4.11.6" },
  { filename: "writer.md", byteLength: 4253, sha256: "92c3e76dc8de5c25f01fe8ec72a787212195699bb2fc416edb1f4b5e6ca2a95c", gitBlob: "8deebfea03dc2098e7109565c5836b428c314c33", firstReleaseTag: "v4.12.0", lastReleaseTag: "v4.13.2" },
  { filename: "writer.md", byteLength: 4386, sha256: "ccbf8dc3957f1c633c95c5b99a0e74237ed1a393c562474cc3443c62abbc47c0", gitBlob: "f50c4ca484cc51d903a1079b0476a895f1400cac", firstReleaseTag: "v4.13.3", lastReleaseTag: "v4.15.7" }
];

// src/config/builtin-skill-entitlements.json
var builtin_skill_entitlements_default = {
  schemaVersion: 1,
  skininthegamebrosOnlySkills: []
};

// src/installer/index.ts
var CLAUDE_CONFIG_DIR = getClaudeConfigDir();
var AGENTS_DIR = join8(CLAUDE_CONFIG_DIR, "agents");
var COMMANDS_DIR = join8(CLAUDE_CONFIG_DIR, "commands");
var SKILLS_DIR = join8(CLAUDE_CONFIG_DIR, "skills");
var HOOKS_DIR = join8(CLAUDE_CONFIG_DIR, "hooks");
var HUD_DIR = join8(CLAUDE_CONFIG_DIR, "hud");
var SETTINGS_FILE = join8(CLAUDE_CONFIG_DIR, "settings.json");
var VERSION_FILE = join8(CLAUDE_CONFIG_DIR, ".omc-version.json");
var VERSION = getRuntimePackageVersion();
var SKININTHEGAMEBROS_ONLY_SKILLS = new Set(
  builtin_skill_entitlements_default.skininthegamebrosOnlySkills.map((skill) => skill.trim().toLowerCase())
);
function isSafeAgentFilename(filename) {
  return /^[a-z0-9-]+\.md$/.test(filename);
}
function isValidHistoricalAgent(record) {
  if (!record || typeof record !== "object") return false;
  const candidate = record;
  return typeof candidate.filename === "string" && isSafeAgentFilename(candidate.filename) && Number.isSafeInteger(candidate.byteLength) && candidate.byteLength > 0 && typeof candidate.sha256 === "string" && /^[a-f0-9]{64}$/.test(candidate.sha256) && typeof candidate.gitBlob === "string" && /^[a-f0-9]{40}$/.test(candidate.gitBlob) && typeof candidate.firstReleaseTag === "string" && /^v4\.\d+\.\d+$/.test(candidate.firstReleaseTag) && typeof candidate.lastReleaseTag === "string" && /^v4\.\d+\.\d+$/.test(candidate.lastReleaseTag);
}
var HISTORICAL_AGENT_HASHES_BY_FILENAME = /* @__PURE__ */ new Map();
for (const record of HISTORICAL_AGENT_OWNERSHIP) {
  if (!isValidHistoricalAgent(record)) continue;
  const hashes = HISTORICAL_AGENT_HASHES_BY_FILENAME.get(record.filename) ?? /* @__PURE__ */ new Set();
  hashes.add(`${record.byteLength}:${record.sha256}`);
  HISTORICAL_AGENT_HASHES_BY_FILENAME.set(record.filename, hashes);
}
function isOmcStatusLine(statusLine) {
  if (!statusLine) return false;
  if (typeof statusLine === "string") {
    return statusLine.includes("omc-hud");
  }
  if (typeof statusLine === "object") {
    const sl = statusLine;
    if (typeof sl.command === "string") {
      return sl.command.includes("omc-hud");
    }
  }
  return false;
}

// src/lib/atomic-write.ts
import * as fsSync from "fs";
import * as path from "path";
import * as crypto from "crypto";
function ensureDirSync(dir) {
  if (fsSync.existsSync(dir)) {
    return;
  }
  try {
    fsSync.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (err.code === "EEXIST") {
      return;
    }
    throw err;
  }
}
function writeAllSync(fd, content, label) {
  const bytes = Buffer.from(content, "utf-8");
  let offset = 0;
  while (offset < bytes.length) {
    const written = fsSync.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!Number.isInteger(written) || written <= 0) {
      throw new Error(`${label} made no progress`);
    }
    offset += written;
  }
  if (fsSync.fstatSync(fd).size !== bytes.length) {
    throw new Error(`${label} size verification failed`);
  }
}
function verifyPrivateTempFile(fd, tempPath, label) {
  const fdStats = fsSync.fstatSync(fd);
  let pathStats;
  try {
    pathStats = fsSync.lstatSync(tempPath);
  } catch {
    throw new Error(`${label} temporary file was replaced before rename`);
  }
  const isWindows2 = process.platform === "win32";
  const isPrivateRegularSingleLink = (stats) => stats.isFile() && (isWindows2 ? stats.nlink <= 1 : stats.nlink === 1) && (isWindows2 || (stats.mode & 511) === 384);
  if (!isPrivateRegularSingleLink(fdStats) || !isPrivateRegularSingleLink(pathStats)) {
    throw new Error(
      `${label} temporary file must be a private regular single-link file`
    );
  }
  if (fdStats.dev !== pathStats.dev || fdStats.ino !== pathStats.ino) {
    throw new Error(`${label} temporary file was replaced before rename`);
  }
}
function verifyPublishedFile(fd, filePath, label) {
  const fdStats = fsSync.fstatSync(fd);
  let pathStats;
  try {
    pathStats = fsSync.lstatSync(filePath);
  } catch {
    throw new Error(`${label} target was replaced at publication`);
  }
  if (!pathStats.isFile() || fdStats.dev !== pathStats.dev || fdStats.ino !== pathStats.ino) {
    throw new Error(`${label} target was replaced at publication`);
  }
}
function preservePriorTarget(filePath) {
  const backupPath = `${filePath}.rollback.${crypto.randomUUID()}`;
  try {
    const stats = fsSync.lstatSync(filePath);
    const isWindows2 = process.platform === "win32";
    if (!stats.isFile() || (isWindows2 ? stats.nlink > 1 : stats.nlink !== 1)) {
      return null;
    }
    fsSync.linkSync(filePath, backupPath);
    return backupPath;
  } catch (error) {
    if (error.code !== "ENOENT") {
      try {
        fsSync.unlinkSync(backupPath);
      } catch {
      }
    }
    return null;
  }
}
function currentFileIdentity(filePath) {
  try {
    const stats = fsSync.lstatSync(filePath);
    return { dev: stats.dev, ino: stats.ino };
  } catch {
    return null;
  }
}
function descriptorIdentity(fd) {
  try {
    const stats = fsSync.fstatSync(fd);
    return { dev: stats.dev, ino: stats.ino };
  } catch {
    return null;
  }
}
function rollbackPriorTarget(filePath, backupPath, expectedIdentity) {
  if (expectedIdentity === null) return;
  const current = currentFileIdentity(filePath);
  if (current === null) return;
  if (expectedIdentity !== null && (current.dev !== expectedIdentity.dev || current.ino !== expectedIdentity.ino)) {
    return;
  }
  try {
    if (backupPath === null) {
      fsSync.unlinkSync(filePath);
    } else {
      fsSync.renameSync(backupPath, filePath);
    }
  } catch {
  }
}
function removeBackup(backupPath) {
  if (backupPath === null) return;
  try {
    fsSync.unlinkSync(backupPath);
  } catch {
  }
}
function atomicWriteFileSync(filePath, content, hooks) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.tmp.${crypto.randomUUID()}`);
  let fd = null;
  let success = false;
  let backupPath = null;
  try {
    ensureDirSync(dir);
    fd = fsSync.openSync(tempPath, "wx", 384);
    writeAllSync(fd, content, "atomic write");
    fsSync.fsyncSync(fd);
    verifyPrivateTempFile(fd, tempPath, "atomic write");
    backupPath = preservePriorTarget(filePath);
    hooks?.beforeRename?.();
    fsSync.renameSync(tempPath, filePath);
    let publishedIdentity = null;
    try {
      verifyPublishedFile(fd, filePath, "atomic write");
      publishedIdentity = descriptorIdentity(fd);
      hooks?.afterRename?.();
      verifyPublishedFile(fd, filePath, "atomic write");
    } catch (error) {
      rollbackPriorTarget(
        filePath,
        backupPath,
        publishedIdentity
      );
      throw error;
    }
    fsSync.closeSync(fd);
    fd = null;
    success = true;
    removeBackup(backupPath);
    try {
      const dirFd = fsSync.openSync(dir, "r");
      try {
        fsSync.fsyncSync(dirFd);
      } finally {
        fsSync.closeSync(dirFd);
      }
    } catch {
    }
  } finally {
    if (fd !== null) {
      try {
        fsSync.closeSync(fd);
      } catch {
      }
    }
    if (!success) {
      try {
        fsSync.unlinkSync(tempPath);
      } catch {
      }
      removeBackup(backupPath);
    }
  }
}
var ATOMIC_BATCH_MAX_CONTENT_BYTES = 1024 * 1024;

// src/hud/copilot-setup.ts
function stripTrailingSeparator(value) {
  if (!value.endsWith(sep3)) return value;
  return value === parsePath(value).root ? value : value.slice(0, -1);
}
function resolveHomeSetting(configured, home, fallbackDirectory) {
  const value = configured?.trim();
  if (!value) {
    return stripTrailingSeparator(normalize3(join10(home, fallbackDirectory)));
  }
  if (value === "~") {
    return stripTrailingSeparator(normalize3(home));
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return stripTrailingSeparator(normalize3(join10(home, value.slice(2))));
  }
  return stripTrailingSeparator(normalize3(value));
}
function getCopilotHome(env = process.env, home = homedir3()) {
  return resolveHomeSetting(env.COPILOT_HOME, home, ".copilot");
}
function getDefaultPackageRoot() {
  let candidate = dirname7(fileURLToPath3(import.meta.url));
  while (true) {
    if (existsSync5(join10(candidate, "package.json")) && existsSync5(
      join10(candidate, "scripts", "lib", "hud-wrapper-template.txt")
    )) {
      return candidate;
    }
    const parent = dirname7(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return resolve3(dirname7(fileURLToPath3(import.meta.url)), "..", "..");
}
function quoteCommandPath2(value) {
  return `"${value.replace(/\\/g, "/").replace(/"/g, '\\"')}"`;
}
function buildCopilotStatusLineCommand(nodePath, wrapperPath) {
  return `${quoteCommandPath2(nodePath)} ${quoteCommandPath2(wrapperPath)}`;
}
function readSettings(settingsPath) {
  if (!existsSync5(settingsPath)) {
    return {
      content: "{\n}\n",
      settings: {},
      valid: true
    };
  }
  const raw = readFileSync5(settingsPath, "utf8");
  const content = raw.trim().length === 0 ? "{\n}\n" : raw;
  const errors = [];
  const parsed = parse2(content, errors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  if (errors.length > 0 || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const detail = errors.length > 0 ? errors.map((error) => printParseErrorCode(error.error)).join(", ") : "settings root must be an object";
    return {
      content,
      settings: {},
      valid: false,
      diagnostic: `Copilot settings.json is invalid JSONC (${detail}); no files were changed.`
    };
  }
  return {
    content,
    settings: parsed,
    valid: true
  };
}
function getOwnership(settingsValid, statusLine) {
  if (!settingsValid) return "invalid";
  if (!statusLine) return "missing";
  return isOmcStatusLine(statusLine) ? "omc" : "third-party";
}
function matchesExpectedStatusLine(statusLine, expectedCommand) {
  if (!statusLine || typeof statusLine !== "object") return false;
  const value = statusLine;
  return value.type === "command" && value.command === expectedCommand;
}
function detectFormatting(content) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const indent = content.match(/\r?\n([ \t]+)"/)?.[1];
  const insertSpaces = !indent?.includes("	");
  return {
    eol,
    insertSpaces,
    tabSize: insertSpaces && indent ? indent.length : 2,
    insertFinalNewline: content.endsWith("\n")
  };
}
function updateStatusLineJsonc(content, existingStatusLine, command) {
  const formattingOptions = detectFormatting(content);
  const desired = { type: "command", command };
  if (existingStatusLine && typeof existingStatusLine === "object" && !Array.isArray(existingStatusLine) && isOmcStatusLine(existingStatusLine)) {
    let updated = content;
    const existing = existingStatusLine;
    if (existing.type !== "command") {
      updated = applyEdits(
        updated,
        modify(updated, ["statusLine", "type"], "command", { formattingOptions })
      );
    }
    if (existing.command !== command) {
      updated = applyEdits(
        updated,
        modify(updated, ["statusLine", "command"], command, { formattingOptions })
      );
    }
    return updated;
  }
  return applyEdits(
    content,
    modify(content, ["statusLine"], desired, { formattingOptions })
  );
}
function readOptionalFile(path2) {
  try {
    return readFileSync5(path2, "utf8");
  } catch {
    return null;
  }
}
function buildSnapshot(options) {
  const home = options.homeDir ?? homedir3();
  const copilotHome = options.copilotHome ? resolveHomeSetting(options.copilotHome, home, ".copilot") : getCopilotHome(process.env, home);
  const packageRoot = resolve3(options.packageRoot ?? getDefaultPackageRoot());
  const settingsPath = join10(copilotHome, "settings.json");
  const wrapperPath = join10(copilotHome, "hud", "omc-hud.mjs");
  const helperPath = join10(copilotHome, "hud", "lib", "config-dir.mjs");
  const pluginRoot = packageRoot;
  const runtimePath = join10(pluginRoot, "bridge", "hud-runtime.mjs");
  const expectedCommand = buildCopilotStatusLineCommand(
    options.nodePath ?? process.execPath,
    wrapperPath
  );
  const parsedSettings = readSettings(settingsPath);
  const statusLine = parsedSettings.settings.statusLine;
  const ownership = getOwnership(parsedSettings.valid, statusLine);
  const wrapperContent = (() => {
    try {
      const wrapper = buildHudWrapper(packageRoot);
      const marker = 'const configuredPluginRoot = "";';
      if (!wrapper.includes(marker)) return null;
      return wrapper.replace(
        marker,
        `const configuredPluginRoot = ${JSON.stringify(pluginRoot)};`
      );
    } catch {
      return null;
    }
  })();
  const helperContent = readOptionalFile(
    join10(packageRoot, "scripts", "lib", "config-dir.mjs")
  );
  const installedWrapper = readOptionalFile(wrapperPath);
  const installedHelper = readOptionalFile(helperPath);
  const wrapperInstalled = installedWrapper !== null;
  const wrapperCurrent = wrapperContent !== null && installedWrapper === wrapperContent;
  const helperCurrent = helperContent !== null && installedHelper === helperContent;
  const runtimeAvailable = existsSync5(runtimePath);
  const configured = ownership === "omc" && matchesExpectedStatusLine(statusLine, expectedCommand);
  const needsRepair = !runtimeAvailable || !configured || !wrapperCurrent || !helperCurrent;
  let diagnostic;
  if (!parsedSettings.valid) {
    diagnostic = parsedSettings.diagnostic ?? "Copilot settings.json is invalid JSONC; no files were changed.";
  } else if (ownership === "third-party") {
    diagnostic = "Copilot statusLine is owned by another tool; no files were changed. Use --replace only after the user explicitly approves replacement.";
  } else if (!runtimeAvailable) {
    diagnostic = `Copilot HUD runtime is missing at ${runtimePath}. Update or reinstall the oh-my-claudecode Copilot plugin.`;
  } else if (wrapperContent === null || helperContent === null) {
    diagnostic = "The installed plugin does not contain the canonical HUD wrapper assets. Update or reinstall the oh-my-claudecode Copilot plugin.";
  } else if (needsRepair) {
    diagnostic = "Copilot HUD setup is missing or stale and can be repaired.";
  } else {
    diagnostic = "Copilot HUD is configured and ready.";
  }
  return {
    copilotHome,
    settingsPath,
    wrapperPath,
    pluginRoot,
    runtimePath,
    expectedCommand,
    ownership,
    settingsValid: parsedSettings.valid,
    runtimeAvailable,
    wrapperInstalled,
    wrapperCurrent,
    configured,
    needsRepair,
    diagnostic,
    settingsContent: parsedSettings.content,
    settings: parsedSettings.settings,
    wrapperContent,
    helperContent,
    helperPath,
    helperCurrent
  };
}
function toPublicStatus(snapshot) {
  const {
    settingsContent: _settingsContent,
    settings: _settings,
    wrapperContent: _wrapperContent,
    helperContent: _helperContent,
    helperPath: _helperPath,
    helperCurrent: _helperCurrent,
    ...status
  } = snapshot;
  return status;
}
function inspectCopilotHud(options = {}) {
  return toPublicStatus(buildSnapshot(options));
}
function writeIfChanged(path2, content, executable = false) {
  if (readOptionalFile(path2) === content) return false;
  atomicWriteFileSync(path2, content);
  if (executable && process.platform !== "win32") {
    chmodSync2(path2, 493);
  }
  return true;
}
function configureCopilotHud(options = {}) {
  const before = buildSnapshot(options);
  const replaceExisting = options.replaceExisting === true;
  const replacedThirdParty = before.ownership === "third-party" && replaceExisting;
  if (!before.settingsValid || before.ownership === "third-party" && !replaceExisting || !before.runtimeAvailable || before.wrapperContent === null || before.helperContent === null) {
    return {
      ...toPublicStatus(before),
      changed: false,
      replacedThirdParty: false
    };
  }
  const wrapperChanged = writeIfChanged(
    before.wrapperPath,
    before.wrapperContent,
    true
  );
  const helperChanged = writeIfChanged(
    before.helperPath,
    before.helperContent
  );
  let settingsChanged = false;
  if (before.ownership !== "omc" || !matchesExpectedStatusLine(
    before.settings.statusLine,
    before.expectedCommand
  )) {
    const updatedSettings = updateStatusLineJsonc(
      before.settingsContent,
      before.settings.statusLine,
      before.expectedCommand
    );
    if (updatedSettings !== before.settingsContent) {
      atomicWriteFileSync(before.settingsPath, updatedSettings);
      settingsChanged = true;
    }
  }
  const after = buildSnapshot(options);
  return {
    ...toPublicStatus(after),
    changed: wrapperChanged || helperChanged || settingsChanged,
    replacedThirdParty
  };
}
function printHumanStatus(action, result) {
  console.log(`[OMC] Copilot HUD ${action}: ${result.diagnostic}`);
  console.log(`  Copilot home: ${result.copilotHome}`);
  console.log(`  Plugin root: ${result.pluginRoot}`);
  console.log(`  statusLine ownership: ${result.ownership}`);
  console.log(`  Command: ${result.expectedCommand}`);
  if ("changed" in result) {
    console.log(`  Changed: ${result.changed ? "yes" : "no"}`);
  }
}
function runCli(args) {
  const pluginDirIndex = args.indexOf("--plugin-dir");
  const action = args.find(
    (arg, index) => !arg.startsWith("-") && (pluginDirIndex < 0 || index !== pluginDirIndex + 1)
  ) ?? "status";
  if (!["setup", "repair", "status", "doctor"].includes(action)) {
    console.error(
      "Usage: copilot-hud-setup.mjs [setup|repair|status|doctor] [--replace] [--json] [--plugin-dir <path>]"
    );
    return 2;
  }
  if (pluginDirIndex >= 0 && !args[pluginDirIndex + 1]) {
    console.error("--plugin-dir requires a path");
    return 2;
  }
  const options = {
    replaceExisting: args.includes("--replace"),
    packageRoot: pluginDirIndex >= 0 ? resolve3(args[pluginDirIndex + 1]) : void 0
  };
  const result = action === "setup" || action === "repair" ? configureCopilotHud(options) : inspectCopilotHud(options);
  if (args.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanStatus(action, result);
  }
  if (!result.settingsValid || result.ownership === "third-party") return 2;
  return result.needsRepair ? 1 : 0;
}
var entrypoint = process.argv[1];
if (entrypoint && resolve3(entrypoint) === resolve3(fileURLToPath3(import.meta.url))) {
  process.exitCode = runCli(process.argv.slice(2));
}
export {
  buildCopilotStatusLineCommand,
  configureCopilotHud,
  getCopilotHome,
  inspectCopilotHud
};
