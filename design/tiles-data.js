// OpenForge tile dataset — names/tags follow the openforge-catalog repo conventions
const F=(w,d,s)=>["component|floor","shape|square",`size|width|${w}`,`size|depth|${d}`,`texture|${s}`,"build|s2w"];
const W=(w,ol,s)=>["component|wall","build|separate wall","shape|wall",`size|width|${w}`,`size|openlock|${ol}`,`texture|${s}`];
const T=(id,name,family,kind,set,sys,geo,w,d,h,mb,tags)=>({id,name,family,kind,set,sys,geo,w,d,h,mb,tags});
export const TILES=[
  T("cs-f-1x1","1×1 Cut Stone Floor","Cut Stone Floor","floor","cut-stone","s2w","floor",1,1,0.25,0.8,F(1,1,"cut stone")),
  T("cs-f-2x1","2×1 Cut Stone Floor","Cut Stone Floor","floor","cut-stone","s2w","floor",2,1,0.25,1.6,F(2,1,"cut stone")),
  T("cs-f-2x2","2×2 Cut Stone Floor","Cut Stone Floor","floor","cut-stone","s2w","floor",2,2,0.25,3.1,F(2,2,"cut stone")),
  T("cs-f-4x2","4×2 Cut Stone Floor","Cut Stone Floor","floor","cut-stone","s2w","floor",4,2,0.25,6.0,F(4,2,"cut stone")),
  T("cs-f-4x4","4×4 Cut Stone Floor","Cut Stone Floor","floor","cut-stone","s2w","floor",4,4,0.25,11.8,F(4,4,"cut stone")),
  T("cs-f-c2r","2r 90° Cut Stone Curved Floor","Cut Stone Curved Floor","floor","cut-stone","s2w","curve",2,2,0.25,3.4,["component|floor","shape|curved","size|radius|2","size|angle|90","texture|cut stone","build|s2w"]),
  T("cs-w-1x","1x Cut Stone Wall (S2W)","Cut Stone Wall","wall","cut-stone","s2w","wall",1,0.3,2,2.2,W(1,"IA","cut stone")),
  T("cs-w-2x","2x Cut Stone Wall (S2W)","Cut Stone Wall","wall","cut-stone","s2w","wall",2,0.3,2,4.1,W(2,"A","cut stone")),
  T("cs-w-4x","4x Cut Stone Wall (S2W)","Cut Stone Wall","wall","cut-stone","s2w","wall",4,0.3,2,8.3,W(4,"Q","cut stone")),
  T("cs-d-2x","2x Cut Stone Doorway (S2W)","Cut Stone Doorway","door","cut-stone","s2w","door",2,0.35,2,5.6,["component|wall","component|wall|door","build|separate wall","size|width|2","size|openlock|A","texture|cut stone"]),
  T("cs-sl-2x","2x Cut Stone Arrow Slit Wall","Cut Stone Wall","wall","cut-stone","s2w","slit",2,0.3,2,4.4,[...W(2,"A","cut stone"),"decoration|arrow slit"]),
  T("cs-wot","2×1 Cut Stone Wall-on-Tile","Cut Stone Wall-on-Tile","wall","cut-stone","wall-on-tile","wallOnTile",2,1,2,5.2,["component|floor","component|floor|wall","build|wall on tile","size|width|2","size|depth|1","texture|cut stone"]),
  T("cs-st-2x2","2×2 Cut Stone Stairs","Cut Stone Stairs","stairs","cut-stone","s2w","stairs",2,2,2,7.1,["component|stairs","size|width|2","size|depth|2","texture|cut stone","build|s2w"]),
  T("cs-col","Cut Stone Round Column","Cut Stone Column","column","cut-stone","s2w","column",1,1,2,3.8,["component|column","size|shape|O","texture|cut stone"]),
  T("ds-f-2x1","2×1 Dungeon Stone Floor","Dungeon Stone Floor","floor","dungeon-stone","s2w","floor",2,1,0.25,1.7,F(2,1,"dungeon stone")),
  T("ds-f-2x2","2×2 Dungeon Stone Floor","Dungeon Stone Floor","floor","dungeon-stone","s2w","floor",2,2,0.25,3.3,F(2,2,"dungeon stone")),
  T("ds-f-4x4","4×4 Dungeon Stone Floor","Dungeon Stone Floor","floor","dungeon-stone","s2w","floor",4,4,0.25,12.5,F(4,4,"dungeon stone")),
  T("ds-w-2x","2x Dungeon Stone Wall (S2W)","Dungeon Stone Wall","wall","dungeon-stone","s2w","wall",2,0.3,2,4.6,W(2,"A","dungeon stone")),
  T("ds-w-4x","4x Dungeon Stone Wall (S2W)","Dungeon Stone Wall","wall","dungeon-stone","s2w","wall",4,0.3,2,9.0,W(4,"Q","dungeon stone")),
  T("ds-d-2x","2x Dungeon Stone Doorway (S2W)","Dungeon Stone Doorway","door","dungeon-stone","s2w","door",2,0.35,2,6.1,["component|wall","component|wall|door","build|separate wall","size|width|2","size|openlock|A","texture|dungeon stone"]),
  T("ds-cp","Dungeon Stone Corner Pillar","Dungeon Stone Pillar","column","dungeon-stone","s2w","pillar",0.5,0.5,2,1.2,["shape|corner pillar","component|wall","texture|dungeon stone"]),
  T("rs-f-2x2","2×2 Rough Stone Floor","Rough Stone Floor","floor","rough-stone","s2w","floor",2,2,0.25,3.6,F(2,2,"rough stone")),
  T("rs-f-4x4","4×4 Rough Stone Floor","Rough Stone Floor","floor","rough-stone","s2w","floor",4,4,0.25,13.2,F(4,4,"rough stone")),
  T("rs-w-2x","2x Rough Stone Wall (S2W)","Rough Stone Wall","wall","rough-stone","s2w","wall",2,0.3,2,5.0,W(2,"A","rough stone")),
  T("sm-f-2x2","2×2 Smooth Floor","Smooth Floor","floor","smooth","s2w","floor",2,2,0.25,2.4,F(2,2,"smooth")),
  T("sm-w-2x","2x Smooth Wall (S2W)","Smooth Wall","wall","smooth","s2w","wall",2,0.3,2,3.5,W(2,"A","smooth")),
  T("pb-1x1","1×1 Plain Base","Plain Base","base","plain","openlock","base",1,1,0.15,0.5,["component|base","component|square","texture|plain","size|width|1","size|depth|1","size|openlock|I"]),
  T("pb-2x2","2×2 Plain Base","Plain Base","base","plain","openlock","base",2,2,0.15,1.8,["component|base","component|square","texture|plain","size|width|2","size|depth|2","size|openlock|E"]),
  T("pb-4x4","4×4 Plain Base","Plain Base","base","plain","openlock","base",4,4,0.15,6.4,["component|base","component|square","texture|plain","size|width|4","size|depth|4","size|openlock|U"]),
  T("sc-crate","Wooden Crate","Scatter","scatter","wood","none","crate",1,1,0.9,2.0,["component|scatter","texture|wood"]),
  T("sc-barrel","Wooden Barrel","Scatter","scatter","wood","none","barrel",1,1,1.0,2.6,["component|scatter","texture|wood"]),
];
TILES.forEach(t=>{ t.file=t.name.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"")+".stl"; t.s3=`s3://openforge-archive/${t.set}/${t.file}`; });
export const KINDS=[["floor","Floors"],["wall","Walls"],["door","Doorways"],["stairs","Stairs"],["column","Columns"],["base","Bases"],["scatter","Scatter"]];
export const SETS=[["cut-stone","Cut Stone"],["dungeon-stone","Dungeon Stone"],["rough-stone","Rough Stone"],["smooth","Smooth"],["plain","Plain"],["wood","Wood"]];
export const SYSTEMS=[["s2w","Separate 2 Wall"],["wall-on-tile","Wall on Tile"],["openlock","OpenLOCK"]];
