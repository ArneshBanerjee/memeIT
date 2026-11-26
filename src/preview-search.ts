/** Browser-only fallback. Desktop search also uses the bundled sentence model. */
export type Searchable = {
  id: string;
  title: string;
  description: string;
  tags: string[];
};

const filler = new Set(
  "a an the this that these those i me my we our you your it its is am are was were be been being of to in on at for from with and or as when where who what how which one meme image picture photo gif reaction want need find show please something about like just really very then".split(
    " ",
  ),
);
const groups = [
  ["guy", "man", "dude", "boyfriend", "male"],
  ["girl", "woman", "lady", "girlfriend", "female"],
  ["other", "another", "different"],
  ["look", "stare", "glance", "gaze", "peek"],
  ["cooked", "doomed", "screwed", "finished", "resigned", "hopeless"],
  ["angry", "mad", "furious", "rage"],
  ["confused", "puzzled", "perplexed", "confusion"],
  ["happy", "delighted", "joy", "cheerful"],
  ["sad", "unhappy", "crying", "miserable"],
  ["shocked", "surprised", "stunned", "astonished"],
  ["suspicious", "skeptical", "doubt", "skeptical"],
  ["tired", "exhausted", "weary", "sleepy"],
];

function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 5 && word.endsWith("ing"))
    return word.slice(0, -3).replace(/(.)\1$/, "$1");
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss"))
    return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return [
    ...new Set(
      (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
        .filter((w) => (w.length > 1 || /^\d+$/.test(w)) && !filler.has(w))
        .map(stem),
    ),
  ];
}

// One insertion/deletion/substitution or transposition. Very short words only
// allow swapped letters, so a typo does not turn cat into car.
function nearby(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3 || Math.abs(a.length - b.length) > 1)
    return false;
  if (a.length === b.length) {
    const different = [...a]
      .map((c, i) => (c === b[i] ? -1 : i))
      .filter((i) => i >= 0);
    if (different.length === 1) return a.length >= 4;
    return (
      different.length === 2 &&
      (a.length === 3 || different[1] === different[0] + 1) &&
      a[different[0]] === b[different[1]] &&
      a[different[1]] === b[different[0]]
    );
  }
  if (Math.min(a.length, b.length) < 4) return false;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

const synonymGroups = groups.map((group) => new Set(group.map(stem)));
function similarity(query: string, candidate: string): number {
  if (query === candidate) return 1;
  if (nearby(query, candidate)) return 0.72;
  return synonymGroups.some((group) => group.has(query) && group.has(candidate))
    ? 0.6
    : 0;
}

export function searchPreview<T extends Searchable>(
  items: T[],
  query: string,
): T[] {
  const terms = words(query);
  if (!terms.length) return items;
  // Longer queries usually describe a scene. Keep visual verbs such as "looking"
  // and let descriptions compete with titles, so a fuzzy word in a short name
  // cannot outweigh several matching people/actions across the actual scene.
  const describing = terms.length > 2;
  const docs = items.map((item) => ({
    item,
    title: words(item.title),
    tags: words(item.tags.join(" ")),
    description: words(item.description),
  }));
  const weights = terms.map((term) => {
    const frequency = docs.filter((doc) =>
      [...doc.title, ...doc.tags, ...doc.description].some(
        (word) => similarity(term, word) > 0,
      ),
    ).length;
    return 1 + Math.log(1 + docs.length / (1 + frequency));
  });
  return docs
    .map((doc) => {
      let score = 0,
        coverage = 0;
      terms.forEach((term, index) => {
        const title = Math.max(
          0,
          ...doc.title.map((word) => similarity(term, word)),
        );
        const tags = Math.max(
          0,
          ...doc.tags.map((word) => similarity(term, word)),
        );
        const description = Math.max(
          0,
          ...doc.description.map((word) => similarity(term, word)),
        );
        const match = Math.max(title, tags, description);
        if (match > 0) coverage++;
        score += weights[index] * (describing
          ? title * 2 + tags * 1.5 + description * 2
          : title * 4 + tags * 2 + description);
      });
      // Reward satisfying the whole description over repeating a common word.
      score *= 0.25 + (coverage / terms.length) ** 2;
      return { item: doc.item, score, coverage };
    })
    .filter((hit) => hit.coverage > 0)
    .sort((a, b) => b.score - a.score)
    .map((hit) => hit.item);
}
