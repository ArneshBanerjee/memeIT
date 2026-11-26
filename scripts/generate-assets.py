#!/usr/bin/env python3
"""Generate MemeIT's original CC0 starter reactions. Requires Pillow >= 10.

No downloaded illustrations, existing meme templates, or font files are used.
The Pillow built-in font supplies rasterized lettering; all artwork is drawn here.
Run: python scripts/generate-assets.py
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
W, H, SCALE = 480, 360, 2
INK = "#141A19"
CREAM = "#FFFDF4"
LIME = "#CDFA57"

# Descriptions are intent metadata, not captions produced by a vision model.
REACTIONS = [
    ("surprised", "Wait. What?", "WAIT. WHAT?", "surprise", "#B8CDFC", True,
     "A wide-eyed little character does a double take. Shocked, surprised, stunned, disbelief, unexpected news, plot twist, cannot believe what I just heard, excuse me what, mind blown, jaw dropped.",
     ["surprised", "shocked", "what", "unexpected", "confused", "disbelief", "plot twist"]),
    ("awkward", "Acting normal", "ACTING NORMAL", "awkward", "#F5B3CA", True,
     "A nervous character glances sideways while trying to look completely normal. Awkward silence, embarrassing moment, caught in the act, pretending nothing happened, uncomfortable small talk, sweating, social anxiety.",
     ["awkward", "nervous", "embarrassed", "caught", "silence", "sweating", "pretending"]),
    ("celebration", "We're so back", "WE'RE SO BACK", "celebrate", LIME, True,
     "An excited character throws both arms up as confetti falls. Celebration, victory, success, good news, finally fixed it, let's go, proud of you, comeback, congratulations, nailed it, winning together.",
     ["celebration", "happy", "success", "win", "congratulations", "excited", "comeback"]),
    ("chaos", "Plan A is on fire", "PLAN A IS ON FIRE", "chaos", "#FFB590", True,
     "A character keeps a brave smile beside a little burning plan. Everything is going wrong, chaos, deadline panic, disaster, pretending things are under control, overwhelmed at work, this is fine, coping with a bad day.",
     ["chaos", "panic", "fire", "disaster", "overwhelmed", "deadline", "coping"]),
    ("judging", "Interesting choice", "INTERESTING CHOICE", "judge", "#C6BEF4", False,
     "A small character gives a skeptical sideways look with one raised eyebrow. Judging a questionable decision, suspicious, side eye, really, doubt, not convinced, sarcastic disagreement, questionable taste.",
     ["judging", "skeptical", "side eye", "suspicious", "doubt", "sarcasm"]),
    ("tired", "Battery: emotionally 1%", "EMOTIONALLY 1%", "tired", "#B7D7DD", False,
     "A sleepy character slumps beside a nearly empty battery. Exhausted, tired, sleepy, drained, burnout, Monday morning, social battery empty, no energy left, need a nap, done for the day.",
     ["tired", "sleepy", "exhausted", "burnout", "monday", "battery", "nap"]),
    ("thinking", "Let me overthink that", "LET ME OVERTHINK\nTHAT", "think", "#F3D877", False,
     "A thoughtful character stares upward at a tiny spiral thought bubble. Overthinking a simple message, confused, calculating, puzzling over a decision, considering possibilities, deep thoughts, wait a minute, brain loading.",
     ["thinking", "overthinking", "confused", "calculating", "decision", "brain", "loading"]),
    ("nope", "Respectfully, nope", "RESPECTFULLY, NOPE", "nope", "#F4ACA0", False,
     "A character raises one palm and leans away. Firm refusal, no thanks, absolutely not, setting boundaries, do not want this, hard pass, rejecting a terrible idea, politely disagreeing, not today.",
     ["no", "nope", "refuse", "boundaries", "pass", "disagree", "reject"]),
    ("support", "You've got this", "YOU'VE GOT THIS", "support", "#BCD9BC", False,
     "A warm little character holds a bright heart. Encouragement, support, comfort, sending love, cheering a friend up, you can do it, proud of you, hope, wholesome, believing in someone, good vibes.",
     ["support", "love", "encouragement", "wholesome", "comfort", "hope", "heart"]),
    ("laughing", "I am not surviving this", "NOT SURVIVING THIS", "laugh", "#C8E68B", False,
     "A laughing character bends over with tears at the corners of its eyes. Hilarious, laughing so hard, dying of laughter, lmao, lol, rofl, cannot breathe, funniest thing ever, losing it, joke.",
     ["laughing", "funny", "hilarious", "lol", "lmao", "joke", "tears"]),
    ("waiting", "Any second now", "ANY SECOND NOW", "wait", "#C7C0D9", False,
     "A patient character sits beside a tiny clock. Waiting for a reply, left on read, taking forever, impatient, any updates, loading, slow response, still here, waiting for the build to finish.",
     ["waiting", "impatient", "reply", "slow", "loading", "updates", "read"]),
    ("oops", "Small miscalculation", "SMALL\nMISCALCULATION", "oops", "#F7C78B", False,
     "A sheepish character stands beside a broken little block. Oops, made a mistake, messed up, accidental disaster, forgot something important, my bad, regret, wrong chat, it was an accident.",
     ["oops", "mistake", "sorry", "accident", "regret", "forgot", "my bad"]),
    ("smug", "Called it", "CALLED IT", "smug", "#B5CEED", False,
     "A pleased character smiles knowingly with folded arms. I told you so, called it, predicted exactly what happened, smug satisfaction, knew it all along, being right, obvious in hindsight.",
     ["smug", "right", "predicted", "called it", "knew it", "satisfaction"]),
    ("sad", "Tiny emotional damage", "TINY EMOTIONAL\nDAMAGE", "sad", "#B5C4E3", False,
     "A small character sits quietly under a tiny rain cloud. Sad, disappointed, hurt feelings, heartbroken, rejected, missing someone, unlucky, emotional damage, a little bit crushed, not okay.",
     ["sad", "disappointed", "hurt", "heartbroken", "rejected", "rain", "unlucky"]),
    ("panic", "Brain has left the chat", "BRAIN HAS LEFT\nTHE CHAT", "panic", "#DBB8EF", False,
     "A startled character looks up as a tiny brain floats away. Brain freeze, cannot think, overwhelmed, confused by instructions, too much information, panic, blanking during a meeting, forgot everything.",
     ["panic", "brain", "confused", "overwhelmed", "blank", "forgot", "meeting"]),
    ("popcorn", "Here for the plot", "HERE FOR THE PLOT", "popcorn", "#F0D189", False,
     "An entertained character clutches a striped snack bucket. Watching drama unfold, gossip, tell me more, interesting story, tea, popcorn, enjoying the chaos from a safe distance, invested in the conversation.",
     ["drama", "popcorn", "gossip", "tea", "story", "watching", "entertained"]),
    ("agree", "Exactly what I meant", "EXACTLY WHAT\nI MEANT", "agree", "#9DD8CB", False,
     "A cheerful character points up beside a bold check mark. Exactly, yes, agreed, this, correct, well said, someone finally gets it, same here, relate, that is what I have been saying.",
     ["agree", "yes", "exactly", "correct", "relatable", "same", "true"]),
    ("leaving", "My cue to disappear", "MY CUE TO\nDISAPPEAR", "leave", "#D4DE9A", False,
     "A character quietly heads toward a tiny exit door. Leaving the conversation, disappearing, avoiding drama, awkward exit, bye, escaping responsibilities, backing away, I should go, not my problem.",
     ["leaving", "bye", "escape", "exit", "avoid", "disappear", "awkward"]),
]


class Canvas:
    def __init__(self, bg: str):
        self.im = Image.new("RGB", (W * SCALE, H * SCALE), bg)
        self.d = ImageDraw.Draw(self.im)

    def box(self, xy):
        return tuple(round(v * SCALE) for v in xy)

    def line(self, points, fill=INK, width=5):
        self.d.line([self.box(p) for p in points], fill=fill, width=width*SCALE, joint="curve")

    def ellipse(self, xy, fill, outline=None, width=4):
        self.d.ellipse(self.box(xy), fill=fill, outline=outline, width=width*SCALE)

    def rect(self, xy, fill, radius=0, outline=None, width=4):
        self.d.rounded_rectangle(self.box(xy), radius*SCALE, fill=fill, outline=outline, width=width*SCALE)

    def poly(self, points, fill, outline=None, width=4):
        points = [self.box(p) for p in points]
        self.d.polygon(points, fill=fill)
        if outline:
            self.d.line(points + [points[0]], fill=outline, width=width*SCALE, joint="curve")

    def arc(self, xy, start, end, fill=INK, width=5):
        self.d.arc(self.box(xy), start, end, fill=fill, width=width*SCALE)

    def text(self, xy, content, size=31, fill=INK, anchor="mm", stroke=0):
        font = ImageFont.load_default(size=size*SCALE)
        self.d.multiline_text(self.box(xy), content, font=font, fill=fill,
                              anchor=anchor, align="center", spacing=2*SCALE,
                              stroke_width=stroke*SCALE)

    def finish(self):
        return self.im.resize((W, H), Image.Resampling.LANCZOS)


def star(c, x, y, r=8, fill=INK):
    c.poly([(x,y-r),(x+3,y-3),(x+r,y),(x+3,y+3),(x,y+r),(x-3,y+3),(x-r,y),(x-3,y-3)],fill)


def heart(c, x, y, size=28, color="#F36F81"):
    c.ellipse((x-size,y-size*.6,x,y+size*.4),color)
    c.ellipse((x,y-size*.6,x+size,y+size*.4),color)
    c.poly([(x-size,y),(x+size,y),(x,y+size)],color)


def render(entry, frame=0, frames=8):
    ident,title,caption,mood,bg,animated,*_ = entry
    c=Canvas(bg)
    t=frame/frames*math.tau
    # Quiet repeated geometry makes the pack feel cohesive without borrowing a meme.
    c.ellipse((28,23,38,33),INK)
    c.text((49,29),"MEMEIT ORIGINALS",12,anchor="lm")
    c.ellipse((420,24,451,55),None,INK,2)
    c.line([(429,39),(442,39)],width=2)
    c.line([(435,33),(435,45)],width=2)
    c.ellipse((133,248,352,275),"#18231F")
    cx=240
    cy=180 + (math.sin(t)*9 if mood=="celebrate" else 0)
    if mood=="chaos": cx+=math.sin(t)*3
    if mood=="leave": cx-=22
    # Bean mascot: a soft rectangular body, oversized face, noodle limbs.
    c.line([(cx-42,cy+50),(cx-45,cy+76),(cx-63,cy+78)],width=6)
    c.line([(cx+42,cy+50),(cx+45,cy+76),(cx+63,cy+78)],width=6)
    c.rect((cx-66,cy-68,cx+66,cy+61),CREAM,48,INK,5)
    if mood=="celebrate":
        c.line([(cx-62,cy+2),(cx-97,cy-20),(cx-110,cy-53)],width=6)
        c.line([(cx+62,cy+2),(cx+97,cy-20),(cx+110,cy-53)],width=6)
    elif mood=="nope":
        c.line([(cx+61,cy+15),(cx+96,cy-5),(cx+96,cy-38)],width=6)
        c.ellipse((cx+85,cy-64,cx+108,cy-31),CREAM,INK,4)
        c.line([(cx-61,cy+15),(cx-88,cy+43)],width=6)
    elif mood=="smug":
        c.line([(cx-62,cy+16),(cx-26,cy+37),(cx+36,cy+20)],width=6)
        c.line([(cx+62,cy+16),(cx+20,cy+41),(cx-31,cy+24)],width=6)
    elif mood in ("support","popcorn"):
        c.line([(cx-62,cy+13),(cx-28,cy+43),(cx,cy+28)],width=6)
        c.line([(cx+62,cy+13),(cx+28,cy+43),(cx,cy+28)],width=6)
    elif mood=="agree":
        c.line([(cx+62,cy+12),(cx+94,cy-11),(cx+94,cy-51)],width=6)
        c.line([(cx-62,cy+12),(cx-89,cy+33)],width=6)
    else:
        c.line([(cx-64,cy+12),(cx-88,cy+31),(cx-85,cy+46)],width=6)
        c.line([(cx+64,cy+12),(cx+88,cy+31),(cx+85,cy+46)],width=6)
    # Expressions have separate eye and mouth styles.
    eye_y=cy-20
    if mood in ("tired","judge","smug"):
        c.line([(cx-42,eye_y-2),(cx-15,eye_y+2)],width=5)
        c.line([(cx+15,eye_y+2),(cx+42,eye_y-2)],width=5)
        if mood=="judge": c.line([(cx+15,eye_y-20),(cx+41,eye_y-26)],width=4)
    elif mood in ("laugh","celebrate","support","agree"):
        c.arc((cx-45,eye_y-11,cx-14,eye_y+14),190,350,width=5)
        c.arc((cx+14,eye_y-11,cx+45,eye_y+14),190,350,width=5)
    elif mood in ("surprise","panic"):
        grow=3+math.sin(t)*2 if mood=="surprise" else 2
        for x in (cx-28,cx+28):
            c.ellipse((x-16-grow,eye_y-20-grow,x+16+grow,eye_y+20+grow),CREAM,INK,4)
            c.ellipse((x-5,eye_y-6,x+5,eye_y+8),INK)
    else:
        dx=math.sin(t)*7 if mood=="awkward" else (6 if mood=="think" else 0)
        for x in (cx-28,cx+28):
            c.ellipse((x-7+dx,eye_y-13,x+7+dx,eye_y+9),INK)
    if mood in ("surprise","panic","oops"):
        c.ellipse((cx-12,cy+7,cx+12,cy+34),INK)
    elif mood in ("celebrate","laugh","agree"):
        c.ellipse((cx-22,cy+4,cx+22,cy+36),INK)
        c.ellipse((cx-12,cy+23,cx+12,cy+35),"#F88F98")
    elif mood in ("sad","tired"):
        c.arc((cx-19,cy+15,cx+19,cy+38),190,350,width=4)
    elif mood in ("awkward","nope","judge","wait","think"):
        c.line([(cx-15,cy+22),(cx+15,cy+22)],width=4)
    else:
        c.arc((cx-22,cy-1,cx+22,cy+28),10,170,width=4)
    # Scene-specific doodles communicate intent even at thumbnail sizes.
    if mood=="surprise":
        c.text((110,116),"!",48)
        c.text((372,133),"?",48)
        star(c,349,83,8)
    elif mood=="awkward":
        c.poly([(330,98),(320,117),(330,124),(340,117)],"#567ED5")
        c.text((111,117),". . .",23)
    elif mood=="celebrate":
        colors=[INK,"#E76DA0","#5A7FDD",CREAM]
        for i in range(18):
            x=67+(i*71)%352
            y=65+(i*37+frame*13)%160
            if 172<x<307 and y>113: continue
            c.line([(x,y),(x+5,y+10)],colors[i%4],4)
        star(c,121,91,14)
        star(c,362,101,10)
    elif mood=="chaos":
        c.rect((344,189,406,242),CREAM,5,INK,3)
        c.line([(357,202),(389,202)],width=3)
        c.line([(357,214),(384,214)],width=3)
        f=math.sin(t)*10
        c.poly([(341,190),(348,158),(362,169),(369,133+f),(382,161),(397,151-f),(408,190)],"#F06433",INK,3)
        c.poly([(357,187),(366,166),(373,176),(387,159),(396,188)],"#FFDF6C")
        c.text((107,111),"OKAY.",17)
    elif mood=="tired":
        c.rect((345,113,404,143),None,5,INK,3)
        c.rect((351,119,358,137),"#E66B63",1)
        c.rect((404,122,411,134),INK,2)
        c.text((116,111),"z",32)
        c.text((93,82),"z",21)
    elif mood=="think":
        c.ellipse((329,86,393,134),CREAM,INK,3)
        c.ellipse((319,136,331,148),CREAM,INK,2)
        c.text((361,109),"?",30)
    elif mood=="nope":
        c.line([(112,96),(138,122)],width=6)
        c.line([(138,96),(112,122)],width=6)
    elif mood=="support":
        heart(c,cx,cy+26,29)
        star(c,124,106,11)
        star(c,365,135,8)
    elif mood=="laugh":
        for x in [cx-55,cx+55]:
            c.poly([(x,cy-10),(x-7,cy+4),(x,cy+9),(x+7,cy+4)],"#5F95D8")
        c.text((106,110),"HA",25)
        c.text((374,110),"HA",25)
    elif mood=="wait":
        c.ellipse((344,106,398,160),CREAM,INK,3)
        c.line([(371,115),(371,134),(385,141)],width=3)
        c.text((111,125),". . .",25)
    elif mood=="oops":
        c.poly([(345,211),(371,202),(374,224),(352,234)],CREAM,INK,3)
        c.poly([(383,202),(403,211),(397,233),(380,225)],CREAM,INK,3)
        c.line([(367,185),(362,174)],width=3)
        c.line([(390,185),(396,174)],width=3)
    elif mood=="smug":
        star(c,355,109,14)
        c.text((116,108),"YEP.",23)
    elif mood=="sad":
        for x,y,r in [(330,87,13),(350,80,18),(371,88,14)]:
            c.ellipse((x-r,y-r,x+r,y+r),CREAM,INK,2)
        c.rect((317,88,385,104),CREAM,9)
        for x in (328,350,372): c.line([(x,115),(x-5,129)],"#5F81BD",3)
    elif mood=="panic":
        c.ellipse((327,76,384,112),"#F5A8B9",INK,3)
        c.arc((341,81,357,104),45,280,width=2)
        c.arc((357,81,375,106),120,350,width=2)
        c.line([(338,120),(332,133)],width=2)
        c.line([(369,121),(366,136)],width=2)
    elif mood=="popcorn":
        c.poly([(cx-32,cy+11),(cx+32,cy+11),(cx+23,cy+65),(cx-23,cy+65)],"#F3746B",INK,3)
        for dx in (-12,10): c.line([(cx+dx,cy+16),(cx+dx,cy+60)],CREAM,7)
        for dx,dy in [(-24,0),(-9,-7),(7,-4),(24,1)]:
            c.ellipse((cx+dx-11,cy+dy-2,cx+dx+11,cy+dy+18),CREAM,INK,2)
        c.text((363,111),"OOH.",22)
    elif mood=="agree":
        c.line([(113,112),(126,126),(150,95)],width=8)
        star(c,353,97,9)
    elif mood=="leave":
        c.rect((354,128,415,246),INK,4)
        c.poly([(363,136),(397,145),(397,246),(363,236)],CREAM,INK,3)
        c.ellipse((385,185,392,192),INK)
        c.line([(111,189),(140,189)],width=4)
        c.line([(100,207),(130,207)],width=4)
    elif mood=="judge":
        c.text((117,112),"HM.",26)
    # Caption remains readable in a compact picker and when pasted into chat.
    y=307 if "\n" not in caption else 308
    size=30 if len(caption.split("\n")[0])<19 else 27
    c.text((240,y),caption,size,stroke=0)
    return c.finish()


def icon():
    im=Image.new("RGBA",(1024,1024),(0,0,0,0))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((40,40,984,984),radius=236,fill=INK)
    d.rounded_rectangle((170,195,854,743),radius=150,fill=LIME)
    d.polygon([(280,691),(280,842),(448,713)],fill=LIME)
    d.line([(314,597),(314,347),(512,520),(710,347),(710,597)],fill=INK,width=67,joint="curve")
    im.save(OUT/"icon.png",optimize=True)


def main():
    OUT.mkdir(exist_ok=True)
    catalog=[]
    for entry in REACTIONS:
        ident,title,caption,mood,bg,animated,description,tags=entry
        kind="gif" if animated else "png"
        filename=f"{ident}.{kind}"
        frames=[render(entry,i) for i in range(8 if animated else 1)]
        if animated:
            frames[0].save(OUT/filename,save_all=True,append_images=frames[1:],
                           duration=140,loop=0,disposal=2,optimize=True)
        else:
            frames[0].save(OUT/filename,optimize=True)
        catalog.append(dict(id=ident,title=title,description=description,tags=tags,filename=filename,kind=kind))
    (OUT/"catalog.json").write_text(json.dumps(catalog,indent=2)+"\n")
    icon()
    provenance={
        "pack":"MemeIT Originals",
        "version":1,
        "license":"CC0-1.0",
        "license_url":"https://creativecommons.org/publicdomain/zero/1.0/",
        "source":"scripts/generate-assets.py",
        "method":"Original programmatic geometric illustrations and captions; no copied meme templates or downloaded artwork. Pillow built-in font rasterization only.",
        "artwork_files": [{"filename":item["filename"],"sha256":hashlib.sha256((OUT/item["filename"]).read_bytes()).hexdigest(),"width":W,"height":H,"frames":8 if item["kind"]=="gif" else 1} for item in catalog],
        "icon":{"filename":"icon.png","sha256":hashlib.sha256((OUT/"icon.png").read_bytes()).hexdigest(),"width":1024,"height":1024},
    }
    (OUT/"provenance.json").write_text(json.dumps(provenance,indent=2)+"\n")
    print(f"Generated {len(catalog)} original reactions and app icon in {OUT}")


if __name__=="__main__":
    main()
