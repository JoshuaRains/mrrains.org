const StemChangersLogic = (() => {
  const VERBS = Object.freeze([
    { infinitive: "dormir", english: "to sleep", acceptedEnglish: ["to sleep", "sleep"], from: "o", to: "ue" },
    { infinitive: "entender", english: "to understand", acceptedEnglish: ["to understand", "understand"], from: "e", to: "ie" },
    { infinitive: "pedir", english: "to ask for", acceptedEnglish: ["to ask for", "ask for", "to request", "request", "to order", "order"], from: "e", to: "i" },
    { infinitive: "cerrar", english: "to close", acceptedEnglish: ["to close", "close"], from: "e", to: "ie" },
    { infinitive: "mover", english: "to move", acceptedEnglish: ["to move", "move"], from: "o", to: "ue" },
    { infinitive: "sentir", english: "to feel", acceptedEnglish: ["to feel", "feel"], from: "e", to: "ie" },
    { infinitive: "poder", english: "to be able to", acceptedEnglish: ["to be able to", "be able to", "to be able", "be able", "can"], from: "o", to: "ue" },
    { infinitive: "empezar", english: "to begin", acceptedEnglish: ["to begin", "begin", "to start", "start"], from: "e", to: "ie" },
    { infinitive: "volver", english: "to return", acceptedEnglish: ["to return", "return", "to go back", "go back", "to come back", "come back"], from: "o", to: "ue" },
    { infinitive: "decir", english: "to say", acceptedEnglish: ["to say", "say", "to tell", "tell"], from: "e", to: "i" },
    { infinitive: "servir", english: "to serve", acceptedEnglish: ["to serve", "serve"], from: "e", to: "i" },
    { infinitive: "pensar", english: "to think", acceptedEnglish: ["to think", "think"], from: "e", to: "ie" },
    { infinitive: "doler", english: "to hurt", acceptedEnglish: ["to hurt", "hurt", "to ache", "ache"], from: "o", to: "ue" },
    { infinitive: "preferir", english: "to prefer", acceptedEnglish: ["to prefer", "prefer"], from: "e", to: "ie" },
    { infinitive: "querer", english: "to want", acceptedEnglish: ["to want", "want"], from: "e", to: "ie" }
  ]);

  const DECIR_FORMS = Object.freeze([
    { label: "yo form of decir", answer: "digo" },
    { label: "tú form of decir", answer: "dices" },
    { label: "él, ella, usted form of decir", answer: "dice" },
    { label: "nosotros form of decir", answer: "decimos" },
    { label: "vosotros form of decir", answer: "decís" },
    { label: "ellos, ellas, ustedes form of decir", answer: "dicen" }
  ]);

  function normalizeAnswer(value) {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("en-US")
      .replace(/[.,!?]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function answerMatches(value, acceptedAnswers) {
    const normalized = normalizeAnswer(value);
    return normalized.length > 0 && acceptedAnswers.some((answer) => normalizeAnswer(answer) === normalized);
  }

  function shuffleVerbs(verbs, random = Math.random) {
    const shuffled = [...verbs];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function avoidRepeatedOrder(current, previous) {
    if (!previous || current.length < 2) return current;
    const repeats = current.every((verb, index) => verb.infinitive === previous[index]?.infinitive);
    return repeats ? [...current.slice(1), current[0]] : current;
  }

  function formatElapsed(milliseconds) {
    const totalHundredths = Math.max(0, Math.floor(milliseconds / 10));
    const minutes = Math.floor(totalHundredths / 6000);
    const seconds = Math.floor((totalHundredths % 6000) / 100);
    const hundredths = totalHundredths % 100;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
  }

  return Object.freeze({
    VERBS,
    DECIR_FORMS,
    normalizeAnswer,
    answerMatches,
    shuffleVerbs,
    avoidRepeatedOrder,
    formatElapsed
  });
})();

if (typeof window !== "undefined") {
  window.StemChangersLogic = StemChangersLogic;
}
