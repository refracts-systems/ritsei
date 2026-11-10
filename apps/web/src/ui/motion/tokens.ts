export const motionDuration = {
  none: 0,
  instant: 80,
  fast: 120,
  press: 160,
  normal: 180,
  deliberate: 240,
  slow: 320,
} as const

// No ease-in: it holds back the first frame, which is the one the user is watching.
export const motionEasing = {
  // Hover and color changes.
  standard: [0.25, 0.1, 0.25, 1],
  // Anything entering, leaving, or answering a press.
  out: [0.23, 1, 0.32, 1],
  // Something already on screen that moves or changes size.
  inOut: [0.77, 0, 0.175, 1],
  // The navigation drawer.
  drawer: [0.32, 0.72, 0, 1],
} as const

export const motionDistance = {
  micro: 2,
  subtle: 4,
  normal: 8,
  prominent: 16,
} as const

export const semanticMotion = {
  feedback: {
    duration: motionDuration.press,
    easing: motionEasing.out,
  },
  enter: {
    duration: motionDuration.normal,
    easing: motionEasing.out,
  },
  // Leaving is quicker than arriving: the system is answering, not asking.
  exit: {
    duration: motionDuration.fast,
    easing: motionEasing.out,
  },
  disclosure: {
    duration: motionDuration.normal,
    easing: motionEasing.out,
  },
  spatial: {
    duration: motionDuration.deliberate,
    easing: motionEasing.inOut,
  },
  drawer: {
    duration: motionDuration.deliberate,
    easing: motionEasing.drawer,
  },
} as const

export const motionSpring = {
  settle: {
    stiffness: 420,
    damping: 36,
    mass: 1,
  },
  reorder: {
    stiffness: 380,
    damping: 32,
    mass: 0.9,
  },
  spatial: {
    stiffness: 400,
    damping: 35,
    mass: 1,
  },
} as const
