/**
 * Whisper was trained on subtitled video, so on silence or noise it tends to
 * "hear" the credits and sign-offs of those subtitles. These lines are dropped
 * from on-device transcripts; real speech that only contains them is rare.
 */
const HALLUCINATION_PATTERNS: RegExp[] = [
    /продолжение следует\.*/gi,
    /субтитр\S*\s+(?:сделал|создавал|делал|подготовил)\S*\s+\S+/gi,
    /редактор субтитров[^.!?]*[.!?]?/gi,
    /корректор\s+[А-ЯЁA-Z]\.\s*\S+/g,
    /спасибо за (?:просмотр|внимание)[.!]*/gi,
    /подписывайтесь на (?:канал|наш канал)[^.!?]*[.!?]?/gi,
    /thanks? (?:you )?for watching[.!]*/gi,
    /subtitles? by [^.!?]*[.!?]?/gi,
    /(?:please )?subscribe to (?:my|our|the) channel[.!]*/gi,
    /\[(?:music|музыка|silence|тишина|blank_audio)\]/gi,
    // Sound captions Whisper adds on non-speech: "[Birds chirping]", "[Смех]", "(звук двигателя)".
    /^\s*[[(][^\])\n]{1,40}[\])]\s*$/gm,
    /\((?:music|музыка)\)/gi,
];

export const stripWhisperHallucinations = (text: string): string => {
    let result = text || '';
    for (const pattern of HALLUCINATION_PATTERNS) {
        result = result.replace(pattern, ' ');
    }
    return result.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
};
