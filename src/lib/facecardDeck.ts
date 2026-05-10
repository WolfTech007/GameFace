/** Default deck: recognizable pop-culture names for FaceCard (Heads Up–style guessing). */
export const POP_CULTURE_DECK: readonly string[] = [
  "Taylor Swift",
  "Drake",
  "Kanye West",
  "Beyoncé",
  "Rihanna",
  "The Weeknd",
  "Travis Scott",
  "Bad Bunny",
  "LeBron James",
  "Michael Jordan",
  "Stephen Curry",
  "Lionel Messi",
  "Cristiano Ronaldo",
  "Tom Brady",
  "Serena Williams",
  "Zendaya",
  "Timothée Chalamet",
  "Ryan Gosling",
  "Margot Robbie",
  "Leonardo DiCaprio",
  "Dwayne Johnson",
  "Kevin Hart",
  "Kim Kardashian",
  "Kylie Jenner",
  "MrBeast",
  "Charli D’Amelio",
  "Kai Cenat",
  "Spider-Man",
  "Batman",
  "Barbie",
  "Shrek",
  "SpongeBob",
  "Harry Potter",
  "Darth Vader",
  "Mario",
] as const;

export function pickTwoDistinctRandom(deck: readonly string[]): [string, string] {
  if (deck.length < 2) throw new Error("Deck needs at least 2 names");
  let i = Math.floor(Math.random() * deck.length);
  let j = Math.floor(Math.random() * deck.length);
  let guard = 0;
  while (i === j && guard++ < 50) {
    j = Math.floor(Math.random() * deck.length);
  }
  if (i === j) {
    j = (i + 1) % deck.length;
  }
  return [deck[i]!, deck[j]!];
}
