// @ts-nocheck
/* ============================================================
   Nalanda — mock data
   Exposes window.DB
   ============================================================ */
const DB: any = {};

DB.user = {
  name: "Ishaan Mehra",
  handle: "@ishaan",
  email: "ishaan.mehra@uni.edu",
  university: "Westlake University",
  major: "Cognitive Science",
  year: "Sophomore",
  language: "English",
  initials: "IM",
  color: "#9c6a39",
  credits: 2840,
  level: 7,
  levelName: "Scholar",
  levelProgress: 64,        // % to next level
  nextLevel: "Mentor",
  vip: true,
  stats: {
    hours: 184, coursesDone: 9, coursesMade: 3,
    uploads: 41, downloads: 128, invites: 6,
    earned: 1260, sold: 23,
  },
};

DB.courses = [
  { id:"c1", code:"COGS 210", name:"Foundations of Cognition", color:"#9c6a39", term:"Spring 2026", mats:12, progress:72, instr:"Dr. Lin" },
  { id:"c2", code:"STAT 230", name:"Statistical Inference", color:"#4a6c8f", term:"Spring 2026", mats:9, progress:48, instr:"Dr. Okafor" },
  { id:"c3", code:"PHIL 180", name:"Mind & Machine", color:"#4f7d52", term:"Spring 2026", mats:7, progress:90, instr:"Dr. Reyes" },
  { id:"c4", code:"CS 245", name:"Data Structures", color:"#a85c6b", term:"Spring 2026", mats:15, progress:35, instr:"Dr. Haddad" },
];

DB.materials = [
  { id:"m1", course:"c1", name:"Lecture 7 — Working Memory.pdf", type:"pdf", size:"3.2 MB", date:"2 days ago", pages:38, downloads:14 },
  { id:"m2", course:"c1", name:"Baddeley Model — slides.ppt", type:"ppt", size:"6.1 MB", date:"5 days ago", pages:42, downloads:31 },
  { id:"m3", course:"c1", name:"Reading notes — attention.md", type:"md", size:"22 KB", date:"1 week ago", pages:6, downloads:8 },
  { id:"m4", course:"c2", name:"Confidence Intervals.pdf", type:"pdf", size:"1.8 MB", date:"yesterday", pages:24, downloads:19 },
  { id:"m5", course:"c2", name:"Hypothesis testing worksheet.docx", type:"doc", size:"410 KB", date:"3 days ago", pages:11, downloads:22 },
  { id:"m6", course:"c3", name:"Searle — Chinese Room.txt", type:"txt", size:"38 KB", date:"6 days ago", pages:9, downloads:5 },
  { id:"m7", course:"c4", name:"Balanced trees cheatsheet.html", type:"html", size:"120 KB", date:"4 days ago", pages:3, downloads:44 },
  { id:"m8", course:"c4", name:"Lecture 9 — Hash maps.pdf", type:"pdf", size:"2.6 MB", date:"1 day ago", pages:31, downloads:12 },
];

DB.knowledge = [
  { t:"Working Memory", d:"A limited-capacity system for temporarily holding and manipulating information during cognitive tasks. Distinct from long-term storage.", tags:["Core","Baddeley"] },
  { t:"Phonological Loop", d:"Subsystem that stores and rehearses verbal & acoustic information; comprises the phonological store and articulatory rehearsal process.", tags:["Component"] },
  { t:"Visuospatial Sketchpad", d:"Handles visual and spatial information — the 'inner eye'. Supports navigation and mental imagery.", tags:["Component"] },
  { t:"Central Executive", d:"Attentional control system that coordinates the subsystems, allocates resources and switches between tasks.", tags:["Core"] },
  { t:"Episodic Buffer", d:"Added in 2000 — a limited store that integrates information across domains into unified episodes, linking to long-term memory.", tags:["Component","2000"] },
  { t:"Capacity Limits", d:"Working memory holds roughly 4±1 chunks; capacity expands through chunking and rehearsal strategies.", tags:["Empirical"] },
];

DB.quiz = [
  { q:"Which component of working memory is responsible for attentional control and coordinating the subsystems?",
    opts:["Phonological loop","Central executive","Episodic buffer","Visuospatial sketchpad"], ans:1,
    why:"The central executive directs attention and coordinates the slave systems; it does not store information itself." },
  { q:"The phonological loop is best described as handling which type of information?",
    opts:["Spatial navigation","Visual imagery","Verbal & acoustic","Emotional valence"], ans:2,
    why:"The phonological loop stores and rehearses verbal and acoustic material." },
  { q:"Approximately how many chunks can working memory hold according to the lecture?",
    opts:["2±1","4±1","9±2","12±3"], ans:1,
    why:"Modern estimates place capacity at about 4±1 chunks, lower than Miller's original 7±2." },
];

DB.graph = {
  root: "Working Memory",
  nodes: [
    { id:"r", label:"Working Memory", x:50, y:48, cls:"root" },
    { id:"a", label:"Central Executive", x:50, y:18, cls:"l1" },
    { id:"b", label:"Phonological Loop", x:20, y:42, cls:"l1" },
    { id:"c", label:"Visuospatial Sketchpad", x:80, y:42, cls:"l1" },
    { id:"d", label:"Episodic Buffer", x:50, y:80, cls:"l1" },
    { id:"e", label:"Articulatory Rehearsal", x:14, y:74, cls:"" },
    { id:"f", label:"Inner Scribe", x:86, y:74, cls:"" },
    { id:"g", label:"Long-term Memory", x:50, y:96, cls:"" },
  ],
  edges: [["r","a"],["r","b"],["r","c"],["r","d"],["b","e"],["c","f"],["d","g"]],
};

DB.exam = {
  title:"COGS 210 — Mock Final Examination",
  meta:"Foundations of Cognition · Duration 120 min · 100 marks",
  sections:[
    { name:"Section A — Multiple Choice (20 marks)", qs:[
      "Define working memory and contrast it with short-term memory. (4)",
      "Identify the component added to Baddeley's model in 2000 and state its function. (4)",
    ]},
    { name:"Section B — Short Answer (40 marks)", qs:[
      "Explain how chunking expands the effective capacity of working memory, with an example. (10)",
      "Describe the dual-task paradigm and how it provides evidence for separate subsystems. (10)",
    ]},
    { name:"Section C — Essay (40 marks)", qs:[
      "Critically evaluate the multi-component model of working memory. To what extent does the episodic buffer resolve its earlier limitations? (40)",
    ]},
  ],
};

DB.notes = [
  { id:"n1", title:"Working Memory — Full Breakdown", course:"c1", courseName:"COGS 210",
    kind:"AI · Knowledge list", items:6, updated:"2 days ago", grad:"linear-gradient(135deg,#9c6a39,#c2924f)",
    desc:"Structured map of Baddeley's model generated from Lecture 7 + reading notes.", source:"Lecture 7 — Working Memory.pdf" },
  { id:"n2", title:"Confidence Intervals — Quiz Set", course:"c2", courseName:"STAT 230",
    kind:"AI · Quiz · 18 Q", items:18, updated:"yesterday", grad:"linear-gradient(135deg,#4a6c8f,#6f93b5)",
    desc:"Interactive practice questions on CI construction and interpretation.", source:"Confidence Intervals.pdf" },
  { id:"n3", title:"Mind & Machine — Knowledge Graph", course:"c3", courseName:"PHIL 180",
    kind:"AI · Graph", items:14, updated:"4 days ago", grad:"linear-gradient(135deg,#4f7d52,#7aa37d)",
    desc:"Concept map linking functionalism, the Chinese Room and the Turing test.", source:"Searle — Chinese Room.txt" },
  { id:"n4", title:"Data Structures — Mock Final", course:"c4", courseName:"CS 245",
    kind:"AI · Exam", items:1, updated:"1 week ago", grad:"linear-gradient(135deg,#a85c6b,#c98794)",
    desc:"Full-length practice paper covering trees, hashing and complexity.", source:"Lecture 9 — Hash maps.pdf" },
  { id:"n5", title:"Attention & Filtering Theories", course:"c1", courseName:"COGS 210",
    kind:"Manual note", items:0, updated:"3 days ago", grad:"linear-gradient(135deg,#7a6a55,#a08d72)",
    desc:"Hand-written summary of Broadbent, Treisman and late-selection models.", source:"—" },
];

DB.market = [
  { id:"k1", title:"Organic Chemistry — Reaction Atlas", author:"Maya R.", ai:"MR", color:"#4f7d52", price:120, free:false,
    rating:4.9, sales:1840, course:"CHEM 220", tags:["Reactions","Mechanisms","Exam-ready"], grad:"linear-gradient(135deg,#4f7d52,#86b089)",
    desc:"Every named reaction for the semester, with mechanism arrows and gotchas. 64 pages." },
  { id:"k2", title:"Linear Algebra in One Night", author:"Dev P.", ai:"DP", color:"#4a6c8f", price:90, free:false,
    rating:4.8, sales:3120, course:"MATH 211", tags:["Cheatsheet","Proofs"], grad:"linear-gradient(135deg,#4a6c8f,#7fa0c1)",
    desc:"Condensed eigen-everything. The note that saved 3,000 GPAs." },
  { id:"k3", title:"Macroeconomics Flash Concepts", author:"Sofia L.", ai:"SL", color:"#a85c6b", price:0, free:true,
    rating:4.7, sales:920, course:"ECON 150", tags:["Free","Flashcards"], grad:"linear-gradient(135deg,#a85c6b,#cd909c)",
    desc:"110 free flashcards on IS-LM, fiscal & monetary policy." },
  { id:"k4", title:"Neuroanatomy Visual Notes", author:"Kenji T.", ai:"KT", color:"#9c6a39", price:160, free:false,
    rating:5.0, sales:640, course:"BIO 240", tags:["Illustrated","Premium"], grad:"linear-gradient(135deg,#9c6a39,#c2924f)",
    desc:"Hand-illustrated brain regions with clinical correlations. Top-rated this term." },
  { id:"k5", title:"Algorithms — Big-O Survival Kit", author:"Priya N.", ai:"PN", color:"#5a6b78", price:75, free:false,
    rating:4.6, sales:2210, course:"CS 245", tags:["Complexity","Patterns"], grad:"linear-gradient(135deg,#5a6b78,#8997a2)",
    desc:"Every complexity class with a worked example and a mnemonic." },
  { id:"k6", title:"Microbiology Rapid Review", author:"Aria W.", ai:"AW", color:"#b07a2b", price:110, free:false,
    rating:4.9, sales:1330, course:"BIO 260", tags:["Review","Diagrams"], grad:"linear-gradient(135deg,#b07a2b,#d2a35a)",
    desc:"Bug-drug charts and gram staining made memorable." },
];

DB.community = [
  { id:"p1", author:"Maya R.", ai:"MR", color:"#4f7d52", time:"2h", university:"Westlake", flair:"Top Creator",
    title:"How I turned 3 months of lecture chaos into one knowledge graph",
    body:"After bombing my midterm I stopped re-reading slides and started feeding everything into a single concept map. Here's the workflow that took me from a C+ to an A-…",
    tags:["Study method","COGS 210"], likes:312, comments:48, saves:96, kind:"Experience" },
  { id:"p2", author:"Dev P.", ai:"DP", color:"#4a6c8f", time:"5h", university:"Northbridge", flair:"",
    title:"Sharing my Linear Algebra note — the proofs section is free this week",
    body:"Eigenvalues finally clicked once I drew the transformations. Dropped a free preview in the market, would love feedback on the spectral theorem page.",
    tags:["Note share","MATH 211"], likes:204, comments:31, saves:140, kind:"Note share" },
  { id:"p3", author:"Sofia L.", ai:"SL", color:"#a85c6b", time:"1d", university:"Westlake", flair:"",
    title:"Does anyone have good material for the IS-LM model?",
    body:"My prof's slides are ancient. Looking for something visual that connects the goods market and money market clearly. Credits offered 🙏",
    tags:["Question","ECON 150"], likes:87, comments:22, saves:14, kind:"Question" },
  { id:"p4", author:"Kenji T.", ai:"KT", color:"#9c6a39", time:"2d", university:"Eastgate", flair:"Top Creator",
    title:"PSA: generate a mock exam BEFORE you review, not after",
    body:"Counterintuitive but it works. The retrieval gaps tell you exactly what to study. I now make the AI mock paper on day one of revision.",
    tags:["Tip","Exam prep"], likes:528, comments:73, saves:301, kind:"Tip" },
];

DB.comments = [
  { author:"Dev P.", ai:"DP", color:"#4a6c8f", time:"1h", body:"This is gold. Did you build the graph from materials or write the nodes yourself?", likes:24 },
  { author:"Aria W.", ai:"AW", color:"#b07a2b", time:"40m", body:"Saved. The 'one map per course' rule changed my whole semester.", likes:11 },
  { author:"Ishaan Mehra", ai:"IM", color:"#9c6a39", time:"12m", body:"Trying this for STAT 230 right now — the auto-linking is doing half the work.", likes:3 },
];

DB.badges = [
  { name:"First Note", icon:"✦", got:true, desc:"Created your first note" },
  { name:"Curator", icon:"❖", got:true, desc:"Uploaded 25 materials" },
  { name:"Mentor", icon:"✿", got:true, desc:"Sold 10 notes" },
  { name:"Streak 30", icon:"✸", got:true, desc:"30-day study streak" },
  { name:"Top 5%", icon:"♕", got:false, desc:"Reach the top 5% of creators" },
  { name:"Polymath", icon:"❀", got:false, desc:"Notes across 6 subjects" },
];

DB.schedule = {
  days:["Mon","Tue","Wed","Thu","Fri"],
  tasks:{
    Mon:[{t:"Review WM knowledge list",done:true},{t:"STAT 230 problem set",done:false}],
    Tue:[{t:"Generate CI quiz · attempt 1",done:true},{t:"PHIL reading: Searle",done:false}],
    Wed:[{t:"CS 245 mock exam",done:false}],
    Thu:[{t:"Re-study graph weak nodes",done:false},{t:"Community: post summary",done:false}],
    Fri:[{t:"Full COGS mock final",done:false}],
  },
};

DB.activity = [
  { ic:"sparkles", t:"Generated a knowledge graph from <b>Searle — Chinese Room.txt</b>", time:"2h ago", cr:"+15" },
  { ic:"upload", t:"Uploaded <b>Lecture 9 — Hash maps.pdf</b> to CS 245", time:"yesterday", cr:"+10" },
  { ic:"coin", t:"Sold <b>Working Memory — Full Breakdown</b> ×3", time:"2 days ago", cr:"+360" },
  { ic:"users", t:"<b>Maya R.</b> accepted your study invite", time:"3 days ago", cr:"+20" },
];

export { DB };
