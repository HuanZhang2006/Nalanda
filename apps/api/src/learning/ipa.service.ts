import { Injectable } from "@nestjs/common";
import { dictionary as cmu } from "cmu-pronouncing-dictionary";

// CMUdict is intentionally local: course creation does not send vocabulary to
// a third party. It provides US-English ARPAbet, converted here to readable IPA.

const PHONE: Record<string, string> = {
  AA: "ɑ", AE: "æ", AH: "ʌ", AO: "ɔ", AW: "aʊ", AY: "aɪ", EH: "ɛ", ER: "ɝ",
  EY: "eɪ", IH: "ɪ", IY: "i", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "u",
  B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ",
  K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p", R: "ɹ", S: "s",
  SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ",
};

function phonesToIpa(value: string) {
  return value.split(/\s+/).filter(Boolean).map((raw) => {
    const match = raw.match(/^([A-Z]+)([012])?$/);
    if (!match) return "";
    const phone = PHONE[match[1]] || "";
    const stress = match[2] === "1" ? "ˈ" : match[2] === "2" ? "ˌ" : "";
    return `${stress}${phone}`;
  }).join("").replace(/([ˈˌ])+/g, "$1");
}

@Injectable()
export class IpaService {
  lookup(term: string): string | null {
    const tokens = term.trim().split(/\s+/);
    const converted = tokens.map((token) => {
      const key = token.toLowerCase().replace(/^[^a-z]+|[^a-z']+$/g, "");
      const pronunciation = cmu[key] || cmu[key.toUpperCase()];
      return pronunciation ? phonesToIpa(pronunciation) : null;
    });
    return converted.every(Boolean) ? converted.join(" ") : null;
  }
}
