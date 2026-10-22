import React from "react";
import { Composition } from "remotion";
import { KineticTitle } from "./components/KineticTitle.jsx";
import { StatCard } from "./components/StatCard.jsx";
import { DialogueBox } from "./components/DialogueBox.jsx";

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="KineticTitle"
        component={KineticTitle}
        durationInFrames={72} // 3 seconds @ 24 fps
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{
          title: "THE GREAT SIEGE",
          subtitle: "YEAR 1066",
          bgColor: "#1B2A4A",
          textColor: "#F5C518",
        }}
      />
      <Composition
        id="StatCard"
        component={StatCard}
        durationInFrames={96} // 4 seconds @ 24 fps
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{
          label: "SURVIVAL RATE",
          percentage: 84,
          accentColor: "#D94040",
        }}
      />
      <Composition
        id="DialogueBox"
        component={DialogueBox}
        durationInFrames={72}
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{
          speaker: "KING EDWARD",
          text: "Retreat is not an option!",
        }}
      />
    </>
  );
};
