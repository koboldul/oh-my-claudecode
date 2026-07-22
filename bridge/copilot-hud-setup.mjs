// src/hud/copilot-setup.ts
import { chmodSync, existsSync as existsSync4, readFileSync as readFileSync4 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname5, join as join8, normalize as normalize2, parse as parsePath, resolve as resolve2, sep as sep2 } from "node:path";
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
    onSeparator: (sep3, offset, length) => {
      if (currentParent.type === "property") {
        if (sep3 === ":") {
          currentParent.colonOffset = offset;
        } else if (sep3 === ",") {
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
import { join as join6, dirname as dirname3, resolve, isAbsolute, basename as basename2 } from "path";

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

// src/hooks/keyword-detector/ultrawork/default.ts
var ULTRAWORK_DEFAULT_MESSAGE = `<ultrawork-mode>

**MANDATORY**: You MUST say "ULTRAWORK MODE ENABLED!" to the user as your first response when this mode activates. This is non-negotiable.

[CODE RED] Maximum precision required. Ultrathink before acting.

## CERTAINTY PROTOCOL

Do not implement until you understand:
- the user's exact intent
- the existing codebase pattern to follow
- which files own the behavior
- how you will verify the result

If uncertainty remains:
1. Explore the codebase in parallel
2. Gather external docs only when needed
3. Use a planner for non-trivial dependency graphs
4. Ask the user only if ambiguity still blocks safe execution

## AGENT UTILIZATION PRINCIPLES

- **Explore first**: spawn exploration work for code paths, patterns, and tests
- **Research when needed**: use document-specialist / researcher agents for external APIs and official docs
- **Plan non-trivial work**: create a dependency-aware task graph before multi-file implementation
- **Delegate by specialty**: use executor, test-engineer, writer, verifier, architect, or critic where each adds value
- **Parallelize independent work**: fire safe independent tasks simultaneously; keep dependent work sequential

## EXECUTION RULES

- **TODO**: Track every meaningful step and mark it complete immediately
- **PARALLEL**: Run independent exploration, implementation, and verification tasks in parallel where safe
- **BACKGROUND FIRST**: Use background tasks for long-running builds, installs, and test suites
- **CONCISE OUTPUTS**: Every Task/Agent result must return only a short execution summary, target under 100 words, covering what changed, files touched, verification status, and blockers
- **VERIFY**: Re-read the request before claiming completion and confirm every requirement is met

## PLANNING GATE

For non-trivial work, produce a plan that includes:
- Parallel Execution Waves
- Dependency Matrix
- critical path
- acceptance criteria
- verification steps

Do not skip planning just because the likely change feels obvious.

## VERIFICATION GUARANTEE

Nothing is done without proof.

Before reporting completion, collect evidence for:
- build/typecheck success
- relevant tests passing
- manual QA or direct feature exercise when applicable
- no new diagnostics on changed files

WITHOUT evidence = NOT verified = NOT done.

</ultrawork-mode>

---
`;
function getDefaultUltraworkMessage() {
  return ULTRAWORK_DEFAULT_MESSAGE;
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
var ULTRAWORK_MESSAGE = getDefaultUltraworkMessage();
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
var STALE_THRESHOLD_MS = 24 * 60 * 60 * 1e3;

// src/lib/paths.ts
var OMC_PLUGIN_MARKETPLACE_SLUG = "omc";
var OMC_PLUGIN_PACKAGE_NAME = "oh-my-claudecode";
var OMC_PLUGIN_CACHE_REL = `plugins/cache/${OMC_PLUGIN_MARKETPLACE_SLUG}/${OMC_PLUGIN_PACKAGE_NAME}`;
var OMC_PLUGIN_MARKETPLACE_REL = `plugins/marketplaces/${OMC_PLUGIN_MARKETPLACE_SLUG}`;

// src/lib/hud-wrapper-template.ts
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join4 } from "node:path";
function buildHudWrapper(packageDir) {
  return readFileSync3(
    join4(packageDir, "scripts", "lib", "hud-wrapper-template.txt"),
    "utf8"
  );
}

// src/utils/user-skill-compat.ts
import { basename, join as join5 } from "path";
var CLAUDE_SKILLS_DIR = join5(getClaudeConfigDir(), "skills");
var OMC_LEARNED_DIR = join5(CLAUDE_SKILLS_DIR, "omc-learned");

// src/installer/claude-md-transaction.ts
var CLAUDE_MD_IMPORT_START = "<!-- OMC:IMPORT:START -->";
var CLAUDE_MD_IMPORT_END = "<!-- OMC:IMPORT:END -->";
var CLAUDE_MD_IMPORT_BLOCK = `${CLAUDE_MD_IMPORT_START}
@CLAUDE-omc.md
${CLAUDE_MD_IMPORT_END}
`;

// src/installer/index.ts
var CLAUDE_CONFIG_DIR = getClaudeConfigDir();
var AGENTS_DIR = join6(CLAUDE_CONFIG_DIR, "agents");
var COMMANDS_DIR = join6(CLAUDE_CONFIG_DIR, "commands");
var SKILLS_DIR = join6(CLAUDE_CONFIG_DIR, "skills");
var HOOKS_DIR = join6(CLAUDE_CONFIG_DIR, "hooks");
var HUD_DIR = join6(CLAUDE_CONFIG_DIR, "hud");
var SETTINGS_FILE = join6(CLAUDE_CONFIG_DIR, "settings.json");
var VERSION_FILE = join6(CLAUDE_CONFIG_DIR, ".omc-version.json");
var VERSION = getRuntimePackageVersion();
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
function atomicWriteFileSync(filePath, content) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.tmp.${crypto.randomUUID()}`);
  let fd = null;
  let success = false;
  try {
    ensureDirSync(dir);
    fd = fsSync.openSync(tempPath, "wx", 384);
    writeAllSync(fd, content, "atomic write");
    fsSync.fsyncSync(fd);
    fsSync.closeSync(fd);
    fd = null;
    fsSync.renameSync(tempPath, filePath);
    success = true;
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
    }
  }
}
var ATOMIC_BATCH_MAX_CONTENT_BYTES = 1024 * 1024;

// src/hud/copilot-setup.ts
function stripTrailingSeparator(value) {
  if (!value.endsWith(sep2)) return value;
  return value === parsePath(value).root ? value : value.slice(0, -1);
}
function resolveHomeSetting(configured, home, fallbackDirectory) {
  const value = configured?.trim();
  if (!value) {
    return stripTrailingSeparator(normalize2(join8(home, fallbackDirectory)));
  }
  if (value === "~") {
    return stripTrailingSeparator(normalize2(home));
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return stripTrailingSeparator(normalize2(join8(home, value.slice(2))));
  }
  return stripTrailingSeparator(normalize2(value));
}
function getCopilotHome(env = process.env, home = homedir3()) {
  return resolveHomeSetting(env.COPILOT_HOME, home, ".copilot");
}
function getDefaultPackageRoot() {
  let candidate = dirname5(fileURLToPath3(import.meta.url));
  while (true) {
    if (existsSync4(join8(candidate, "package.json")) && existsSync4(
      join8(candidate, "scripts", "lib", "hud-wrapper-template.txt")
    )) {
      return candidate;
    }
    const parent = dirname5(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return resolve2(dirname5(fileURLToPath3(import.meta.url)), "..", "..");
}
function quoteCommandPath2(value) {
  return `"${value.replace(/\\/g, "/").replace(/"/g, '\\"')}"`;
}
function buildCopilotStatusLineCommand(nodePath, wrapperPath) {
  return `${quoteCommandPath2(nodePath)} ${quoteCommandPath2(wrapperPath)}`;
}
function readSettings(settingsPath) {
  if (!existsSync4(settingsPath)) {
    return {
      content: "{\n}\n",
      settings: {},
      valid: true
    };
  }
  const raw = readFileSync4(settingsPath, "utf8");
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
    return readFileSync4(path2, "utf8");
  } catch {
    return null;
  }
}
function buildSnapshot(options) {
  const home = options.homeDir ?? homedir3();
  const copilotHome = options.copilotHome ? resolveHomeSetting(options.copilotHome, home, ".copilot") : getCopilotHome(process.env, home);
  const packageRoot = resolve2(options.packageRoot ?? getDefaultPackageRoot());
  const settingsPath = join8(copilotHome, "settings.json");
  const wrapperPath = join8(copilotHome, "hud", "omc-hud.mjs");
  const helperPath = join8(copilotHome, "hud", "lib", "config-dir.mjs");
  const pluginRoot = packageRoot;
  const runtimePath = join8(pluginRoot, "bridge", "hud-runtime.mjs");
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
    join8(packageRoot, "scripts", "lib", "config-dir.mjs")
  );
  const installedWrapper = readOptionalFile(wrapperPath);
  const installedHelper = readOptionalFile(helperPath);
  const wrapperInstalled = installedWrapper !== null;
  const wrapperCurrent = wrapperContent !== null && installedWrapper === wrapperContent;
  const helperCurrent = helperContent !== null && installedHelper === helperContent;
  const runtimeAvailable = existsSync4(runtimePath);
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
    chmodSync(path2, 493);
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
    packageRoot: pluginDirIndex >= 0 ? resolve2(args[pluginDirIndex + 1]) : void 0
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
if (entrypoint && resolve2(entrypoint) === resolve2(fileURLToPath3(import.meta.url))) {
  process.exitCode = runCli(process.argv.slice(2));
}
export {
  buildCopilotStatusLineCommand,
  configureCopilotHud,
  getCopilotHome,
  inspectCopilotHud
};
