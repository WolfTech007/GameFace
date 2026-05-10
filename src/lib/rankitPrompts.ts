/**
 * V1 deck: “Pop Culture Debates”. Each row is exactly five items.
 * Add new rows here — ids are assigned automatically (`pc_001`, …).
 */

export type RankItDeckEntry = {
  id: string;
  question: string;
  items: [string, string, string, string, string];
};

const RAW: Omit<RankItDeckEntry, "id">[] = [
  {
    question: "Best Fast Food",
    items: ["Chipotle", "Chick-fil-A", "Taco Bell", "McDonald's", "Subway"],
  },
  {
    question: "Best Superpowers",
    items: ["Flying", "Teleportation", "Mind Reading", "Invisibility", "Time Travel"],
  },
  {
    question: "Worst Personality Traits",
    items: ["Narcissistic", "Lazy", "Jealous", "Manipulative", "Arrogant"],
  },
  {
    question: "Best Vacation Cities",
    items: ["Tokyo", "Paris", "New York", "Rome", "London"],
  },
  {
    question: "Most Overrated Celebrities",
    items: ["Drake", "Elon Musk", "Kim Kardashian", "Logan Paul", "Tom Cruise"],
  },
  {
    question: "Best NBA Players (All Time)",
    items: ["LeBron James", "Stephen Curry", "Michael Jordan", "Kobe Bryant", "Shaq"],
  },
  {
    question: "Most Annoying Habits",
    items: ["Chewing loud", "Being late", "Talking over people", "Leaving texts unread", "Flexing online"],
  },
  {
    question: "Most Iconic Cartoons",
    items: ["SpongeBob", "The Simpsons", "Family Guy", "South Park", "Adventure Time"],
  },
  {
    question: "Best Snacks",
    items: ["Doritos", "Oreos", "Popcorn", "Sour Patch Kids", "Takis"],
  },
  {
    question: "Most Likely To Survive a Zombie Apocalypse",
    items: ["MrBeast", "LeBron James", "Gordon Ramsay", "Taylor Swift", "Elon Musk"],
  },
  {
    question: "Best Marvel Heroes",
    items: ["Spider-Man", "Iron Man", "Black Panther", "Thor", "Doctor Strange"],
  },
  {
    question: "Worst Ways To End a Text",
    items: ["K", "Sure.", "lol ok", "We need to talk", "Seen"],
  },
  {
    question: "Best Streaming Era TV",
    items: ["Breaking Bad", "Game of Thrones", "Stranger Things", "The Office", "Succession"],
  },
  {
    question: "Most Iconic Pop Stars",
    items: ["Taylor Swift", "Beyoncé", "Britney Spears", "Madonna", "Michael Jackson"],
  },
  {
    question: "Best Pizza Toppings",
    items: ["Pepperoni", "Mushrooms", "Pineapple", "Sausage", "Olives"],
  },
  {
    question: "Best Study Snacks",
    items: ["Coffee", "Trail mix", "Ramen", "Energy drinks", "Apple slices"],
  },
  {
    question: "Most Chaotic Social Media",
    items: ["X / Twitter", "TikTok", "Instagram", "Facebook", "Reddit"],
  },
  {
    question: "Best Late-Night Host Energy",
    items: ["Conan", "Letterman", "Fallon", "Kimmel", "Colbert"],
  },
  {
    question: "Best Comfort Movies",
    items: ["Clueless", "Mean Girls", "Legally Blonde", "10 Things I Hate About You", "Easy A"],
  },
  {
    question: "Worst Movie Clichés",
    items: ["Chosen one", "Twist villain", "Slow-mo walk", "Love triangle", "Running from explosions"],
  },
  {
    question: "Best Album Openers",
    items: ["Thriller", "Smells Like Teen Spirit", "DNA.", "Welcome to New York", "Start Me Up"],
  },
  {
    question: "Best Comfort Foods",
    items: ["Mac and cheese", "Grilled cheese", "Ice cream", "Mashed potatoes", "Chicken soup"],
  },
  {
    question: "Most Relatable Villains",
    items: ["Magneto", "Thanos", "Loki", "Killmonger", "Tyler Durden"],
  },
  {
    question: "Best Disney Princess Films",
    items: ["Moana", "Tangled", "Frozen", "Mulan", "The Little Mermaid"],
  },
  {
    question: "Best Reality TV Chaos",
    items: ["Love Island", "The Bachelor", "Survivor", "Big Brother", "RuPaul's Drag Race"],
  },
  {
    question: "Best Sitcom Duos",
    items: ["Jim & Pam", "Troy & Abed", "Joey & Chandler", "Leslie & Ann", "Michael & Dwight"],
  },
  {
    question: "Worst Fashion Trends",
    items: ["Low-rise jeans", "Trucker hats", "Crocs (early era)", "Velour tracksuits", "Popcorn shirts"],
  },
  {
    question: "Best Concert Experiences",
    items: ["Arena pop show", "Tiny club", "Festival headliner", "Orchestra night", "Outdoor stadium"],
  },
  {
    question: "Best Gaming Franchises",
    items: ["Mario", "Zelda", "Pokémon", "Minecraft", "Fortnite"],
  },
  {
    question: "Best Movie Snacks",
    items: ["Popcorn", "Nachos", "Sour candy", "Icee", "Hot dog"],
  },
  {
    question: "Most Iconic Internet Moments",
    items: ["Ice bucket challenge", "Harlem Shake", "Flash mobs", "Planking", "Mannequin challenge"],
  },
  {
    question: "Best Rom-Com Leads",
    items: ["Julia Roberts", "Meg Ryan", "Hugh Grant", "Matthew McConaughey", "Reese Witherspoon"],
  },
  {
    question: "Best Coffee Orders",
    items: ["Oat latte", "Cold brew", "Espresso", "Cappuccino", "Iced Americano"],
  },
  {
    question: "Best Stand-Up Specials Vibes",
    items: ["Observational", "Storytelling", "Roast", "Absurdist", "Crowd work"],
  },
  {
    question: "Best Pixar Films",
    items: ["Toy Story", "The Incredibles", "Inside Out", "Wall-E", "Ratatouille"],
  },
  {
    question: "Worst Group Chat Behaviors",
    items: ["Leaving people on read", "Spamming voice notes", "Silent lurkers", "@ everyone", "Screenshot drama"],
  },
  {
    question: "Best Theme Park Days",
    items: ["Disney", "Universal", "Six Flags", "State fair", "Water park"],
  },
  {
    question: "Best Music Festivals (Reputation)",
    items: ["Coachella", "Lollapalooza", "Bonnaroo", "Electric Daisy", "Governors Ball"],
  },
  {
    question: "Best Villain Songs",
    items: ["Be Prepared", "Poor Unfortunate Souls", "You're Welcome", "Cruella De Vil", "Friends on the Other Side"],
  },
  {
    question: "Best Fast Casual Bowls",
    items: ["Burrito bowl", "Poke bowl", "Sushi bowl", "Mediterranean bowl", "BBQ bowl"],
  },
  {
    question: "Best Comfort TV Rewatches",
    items: ["Parks and Recreation", "Brooklyn Nine-Nine", "New Girl", "Community", "Modern Family"],
  },
  {
    question: "Best Plot Twists (No Spoilers)",
    items: ["Found-family reveal", "Secret twin", "It was all a dream", "Unreliable narrator", "Time loop"],
  },
  {
    question: "Best Karaoke Songs",
    items: ["Don't Stop Believin'", "Bohemian Rhapsody", "Shallow", "Wannabe", "Livin' on a Prayer"],
  },
  {
    question: "Best Movie Soundtracks",
    items: ["Guardians of the Galaxy", "Pulp Fiction", "Black Panther", "O Brother", "Drive"],
  },
  {
    question: "Best Travel Buddies",
    items: ["Best friend", "Partner", "Sibling", "Cousin", "Solo"],
  },
  {
    question: "Best Dating App Archetypes",
    items: ["Dog guy", "Hiking guy", "Astrology girl", "Theatre kid", "Finance bro"],
  },
  {
    question: "Best Holiday Movies",
    items: ["Elf", "Home Alone", "Love Actually", "Die Hard", "The Holiday"],
  },
  {
    question: "Best Concert Merch",
    items: ["Tour tee", "Hoodie", "Poster", "Tote bag", "Friendship bracelet"],
  },
  {
    question: "Best Sci-Fi Futures",
    items: ["Star Trek utopia", "Star Wars adventure", "Blade Runner noir", "Matrix simulation", "Dune destiny"],
  },
  {
    question: "Best Breakfast Foods",
    items: ["Pancakes", "Waffles", "Bagel & lox", "Avocado toast", "Breakfast burrito"],
  },
  {
    question: "Best Party Games",
    items: ["Charades", "Cards Against Humanity", "Werewolf", "Jackbox", "Beer pong"],
  },
  {
    question: "Best Villain Aesthetics",
    items: ["Sharp suits", "Neon cyber", "Gothic castle", "Minimalist CEO", "Campy glam"],
  },
  {
    question: "Best Internet Drama Archetypes",
    items: ["Cancel storm", "Stan wars", "Quote tweet pile-on", "Notes app apology", "GoFundMe saga"],
  },
  {
    question: "Best Study Playlists",
    items: ["Lo-fi beats", "White noise", "Film scores", "Classical", "Rain sounds"],
  },
  {
    question: "Best Animated Villains",
    items: ["Scar", "Yzma", "Hades", "Facilier", "Hopper"],
  },
];

export const POP_CULTURE_DEBATES: RankItDeckEntry[] = RAW.map((row, i) => ({
  id: `pc_${String(i + 1).padStart(3, "0")}`,
  ...row,
}));

/** Deterministic shuffle for a match — repeatable deck order without repeats until wrap. */
export function shuffleMatchDeckOrder(roomId: string): number[] {
  const n = POP_CULTURE_DEBATES.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  let seed = 2166136261;
  for (let c = 0; c < roomId.length; c++) {
    seed ^= roomId.charCodeAt(c);
    seed = Math.imul(seed, 16777619);
  }
  for (let i = idx.length - 1; i > 0; i--) {
    seed = (seed * 48271 + 0x7fffffff) >>> 0;
    const j = seed % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}
