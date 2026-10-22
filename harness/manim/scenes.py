#!/usr/bin/env python3
"""
Manim 2D Animation Generators for html-anime.
Adheres strictly to the project palette, bold black outlines, and flat fills.
"""

import sys
from pathlib import Path
from manim import (
    Scene,
    config,
    VMobject,
    CurvedArrow,
    DashedVMobject,
    Line,
    Circle,
    Square,
    Polygon,
    Text,
    MathTex,
    VGroup,
    Create,
    Write,
    FadeIn,
    FadeOut,
    Transform,
    Rotate,
    UP,
    DOWN,
    LEFT,
    RIGHT,
    ORIGIN,
    ManimColor,
    rate_functions,
)

# Load shared palette
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from palette import PALETTE, TONES

# Configure 1920x1080 @ 24 fps
config.pixel_width = 1920
config.pixel_height = 1080
config.frame_rate = 24
config.background_opacity = 0.0  # Transparent by default for overlaying onto doodle backdrops


def pcolor(name):
    """Retrieve a ManimColor from the shared project palette."""
    hex_val = PALETTE.get(name, PALETTE["black"])
    return ManimColor.from_hex(hex_val)


def tcolor(name):
    """Retrieve a ManimColor from the shared project tones."""
    hex_val = TONES.get(name, PALETTE["black"])
    return ManimColor.from_hex(hex_val)


class TacticalBattleMap(Scene):
    """
    OverSimplified-style tactical military battle map.
    Animates curved troop invasion arrows, fortress targets, and tactical markers.
    """
    def construct(self):
        # 1. Base map regions / territory outlines
        territory_a = Polygon(
            [-6, -3, 0], [-1, -3.5, 0], [-0.5, 1, 0], [-4, 2.5, 0], [-6, 1, 0],
            color=pcolor("black"),
            fill_color=pcolor("tan"),
            fill_opacity=0.35,
            stroke_width=6,
        )
        territory_b = Polygon(
            [-0.5, 1, 0], [4.5, 2, 0], [6, -1, 0], [2, -3.2, 0], [-1, -3.5, 0],
            color=pcolor("black"),
            fill_color=pcolor("cobalt"),
            fill_opacity=0.35,
            stroke_width=6,
        )

        label_a = Text("KINGDOM", font="Permanent Marker", font_size=42, color=pcolor("black"))
        label_a.move_to([-3.5, 0, 0])

        label_b = Text("EMPIRE", font="Permanent Marker", font_size=42, color=pcolor("black"))
        label_b.move_to([3, 0, 0])

        self.play(Create(territory_a), Create(territory_b), Write(label_a), Write(label_b), run_time=1.0)

        # 2. Invasion arrow (bold red with black stroke effect)
        arrow1 = CurvedArrow(
            start_point=[-2.5, 1.5, 0],
            end_point=[1.5, 1.8, 0],
            color=pcolor("red"),
            stroke_width=12,
            angle=-0.5,
        )
        arrow2 = CurvedArrow(
            start_point=[-2.0, -1.8, 0],
            end_point=[1.2, -1.2, 0],
            color=pcolor("red"),
            stroke_width=12,
            angle=0.4,
        )

        self.play(Create(arrow1), Create(arrow2), run_time=1.5, rate_func=rate_functions.ease_out_cubic)

        # 3. Flanking marker (OverSimplified dashed encirclement)
        circle_flank = DashedVMobject(
            Circle(radius=1.6, color=pcolor("yellow"), stroke_width=8).move_to([2.2, 0.2, 0]),
            num_dashes=14,
        )
        self.play(Create(circle_flank), run_time=1.0)
        self.wait(0.5)


class TrajectoryPhysics(Scene):
    """
    Ballistic trajectory arc (e.g. catapult, cannonball, arrow volley) with velocity vector.
    """
    def construct(self):
        # Ground indicator line
        ground = Line(start=[-7, -2.5, 0], end=[7, -2.5, 0], color=pcolor("green"), stroke_width=8)
        self.play(Create(ground), run_time=0.5)

        # Parabolic projectile arc
        arc_points = [
            [-5.5, -2.5, 0],
            [-4.0, 0.5, 0],
            [-2.0, 2.3, 0],
            [0.5, 2.5, 0],
            [3.0, 1.2, 0],
            [4.5, -2.5, 0],
        ]
        arc = VMobject(color=pcolor("black"), stroke_width=6)
        arc.set_points_smoothly(arc_points)

        dashed_arc = DashedVMobject(arc, num_dashes=24)
        cannonball = Circle(radius=0.22, color=pcolor("black"), fill_color=pcolor("grey"), fill_opacity=1.0, stroke_width=4)
        cannonball.move_to(arc_points[0])

        self.play(Create(dashed_arc), FadeIn(cannonball), run_time=1.0)
        self.play(cannonball.animate(rate_func=rate_functions.ease_in_out_quad, run_time=1.8).move_to(arc_points[-1]))

        # Impact mark (burst X)
        x1 = Line(start=[4.1, -2.9, 0], end=[4.9, -2.1, 0], color=pcolor("red"), stroke_width=8)
        x2 = Line(start=[4.1, -2.1, 0], end=[4.9, -2.9, 0], color=pcolor("red"), stroke_width=8)
        self.play(Create(x1), Create(x2), run_time=0.3)
        self.wait(0.4)


class DynamicStatsChart(Scene):
    """
    Doodle-styled bar chart / count-up comparison with palette fills.
    """
    def construct(self):
        # Title
        title = Text("CASUALTIES", font="Permanent Marker", font_size=48, color=pcolor("black"))
        title.to_edge(UP, buff=0.8)
        self.play(Write(title), run_time=0.6)

        # Bars
        bar1 = Polygon(
            [-3.5, -2.5, 0], [-1.5, -2.5, 0], [-1.5, 0.8, 0], [-3.5, 0.8, 0],
            color=pcolor("black"), fill_color=pcolor("cobalt"), fill_opacity=1.0, stroke_width=6,
        )
        bar2 = Polygon(
            [1.5, -2.5, 0], [3.5, -2.5, 0], [3.5, 2.2, 0], [1.5, 2.2, 0],
            color=pcolor("black"), fill_color=pcolor("red"), fill_opacity=1.0, stroke_width=6,
        )

        lbl1 = Text("DEFENDERS", font="Permanent Marker", font_size=32, color=pcolor("black")).next_to(bar1, DOWN, buff=0.3)
        lbl2 = Text("INVADERS", font="Permanent Marker", font_size=32, color=pcolor("black")).next_to(bar2, DOWN, buff=0.3)

        num1 = Text("12,000", font="Permanent Marker", font_size=36, color=pcolor("yellow")).next_to(bar1, UP, buff=0.2)
        num2 = Text("48,000", font="Permanent Marker", font_size=36, color=pcolor("yellow")).next_to(bar2, UP, buff=0.2)

        self.play(Create(bar1), Create(bar2), Write(lbl1), Write(lbl2), run_time=1.0)
        self.play(FadeIn(num1, shift=UP*0.3), FadeIn(num2, shift=UP*0.3), run_time=0.6)
        self.wait(0.8)
