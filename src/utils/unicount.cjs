"use strict";

const strPosToUni = (value, stringOffset = value.length) => {
	let pairs = 0;
	let index = 0;
	for (; index < stringOffset; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdfff) {
			pairs += 1;
			index += 1;
		}
	}
	if (index !== stringOffset) {
		throw new Error("Invalid offset - splits unicode bytes");
	}
	return index - pairs;
};

const uniToStrPos = (value, unicodeOffset) => {
	let position = 0;
	for (let remaining = unicodeOffset; remaining > 0; remaining -= 1) {
		const code = value.charCodeAt(position);
		position += code >= 0xd800 && code <= 0xdfff ? 2 : 1;
	}
	return position;
};

module.exports = { strPosToUni, uniToStrPos };
