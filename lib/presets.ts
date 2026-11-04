import type { WardenAutomotivePreset } from "./types.ts";

const OFFICIAL_QPP_SIGNAL_CATALOG_HEADER = `/*
 * Copyright (c) 2025, BlackBerry Limited. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Extracted from COVESA Vehicle Signal Specification (VSS v3) signal_catalog.json
 */`;

export const AUTOMOTIVE_PRESETS: readonly WardenAutomotivePreset[] = [
  {
    id: "preset-1-bounds-float-bug",
    title: "Mirror Pan & Wiper Bounds + Float Bug",
    description:
      "Demonstrates pre-compiled COVESA VSS min/max/allowed/arraysize enforcement (ERANGE / EINVAL) alongside fixes for upstream QPP's FLOAT default corruption (22.5 -> 0.0 at qpp/value.c:438) and VECTOR_UINT32 UINT16_MAX truncation (qpp/value.c:73).",
    catalogJsonc: `${OFFICIAL_QPP_SIGNAL_CATALOG_HEADER}
{
  "Vehicle": {
    "type": "branch",
    "children": {
      "Cabin": {
        "type": "branch",
        "children": {
          "HVAC": {
            "type": "branch",
            "children": {
              "Station": {
                "type": "branch",
                "children": {
                  "Row1": {
                    "type": "branch",
                    "children": {
                      "Driver": {
                        "type": "branch",
                        "children": {
                          "Temperature": {
                            "datatype": "float",
                            "type": "actuator",
                            "min": -40.0,
                            "max": 125.0,
                            "default": 22.5,
                            "unit": "celsius",
                            "description": "Driver HVAC target temperature (FLOAT default bug proof)"
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "Body": {
        "type": "branch",
        "children": {
          "Mirrors": {
            "type": "branch",
            "children": {
              "Left": {
                "type": "branch",
                "children": {
                  "Pan": {
                    "datatype": "int8",
                    "type": "actuator",
                    "min": -100,
                    "max": 100,
                    "default": 0,
                    "unit": "percent",
                    "description": "Left mirror pan actuator [-100, 100]"
                  }
                }
              }
            }
          },
          "Windshield": {
            "type": "branch",
            "children": {
              "Front": {
                "type": "branch",
                "children": {
                  "Wiping": {
                    "type": "branch",
                    "children": {
                      "Mode": {
                        "datatype": "string",
                        "type": "actuator",
                        "allowed": ["OFF", "SLOW", "MEDIUM", "FAST"],
                        "default": "OFF",
                        "description": "Front windshield wiper mode enum"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "OBD": {
        "type": "branch",
        "children": {
          "DTCList": {
            "datatype": "uint32[]",
            "type": "actuator",
            "arraysize": 4,
            "min": 0,
            "max": 4294967295,
            "default": [65535],
            "description": "OBD diagnostic trouble code vector (VECTOR_UINT32 > 65535 proof)"
          }
        }
      }
    }
  }
}`,
    operations: [
      {
        kind: "OPEN",
        fd: 1,
        path: "Vehicle/Cabin/HVAC/Station/Row1/Driver/Temperature",
        pid: 1010,
        priority: 30,
        leaseMs: 800,
        role: "HVAC_Controller",
      },
      {
        kind: "OPEN",
        fd: 2,
        path: "Vehicle.Body.Mirrors.Left.Pan",
        pid: 1020,
        priority: 25,
        leaseMs: 800,
        role: "Body_Mirror_ECU",
      },
      {
        kind: "WRITE",
        fd: 2,
        value: -35,
        nowMs: 100,
      },
      {
        kind: "WRITE",
        fd: 2,
        value: 120,
        nowMs: 150,
      },
      {
        kind: "OPEN",
        fd: 3,
        path: "Vehicle/Body/Windshield/Front/Wiping/Mode?control,text",
        pid: 1030,
        priority: 35,
        leaseMs: 800,
        role: "Rain_Sensor_ECU",
      },
      {
        kind: "WRITE",
        fd: 3,
        value: "FAST",
        nowMs: 200,
      },
      {
        kind: "WRITE",
        fd: 3,
        value: "HYPER_TURBO",
        nowMs: 250,
      },
      {
        kind: "OPEN",
        fd: 4,
        path: "Vehicle/OBD/.DTCList.control",
        pid: 1040,
        priority: 40,
        leaseMs: 800,
        role: "OBD_Scanner",
      },
      {
        kind: "WRITE",
        fd: 4,
        value: [70000, 4000000000],
        nowMs: 300,
      },
      {
        kind: "READ_WARDEN",
        path: "Vehicle/Body/Mirrors/Left/Pan?warden,text",
        nowMs: 350,
      },
    ],
  },
  {
    id: "preset-2-adas-vs-ivi-hijack",
    title: "ADAS P60 vs IVI P10 Actuator Hijack",
    description:
      "Prevents a low-criticality Infotainment script (IVI_EcoMode, Priority P10) from overwriting an active emergency brake / speed command issued by ADAS Automatic Emergency Braking (ADAS_AEB, Priority P60).",
    catalogJsonc: `${OFFICIAL_QPP_SIGNAL_CATALOG_HEADER}
{
  "Vehicle": {
    "type": "branch",
    "children": {
      "ADAS": {
        "type": "branch",
        "children": {
          "CruiseControl": {
            "type": "branch",
            "children": {
              "SpeedSet": {
                "datatype": "int8",
                "type": "actuator",
                "min": 0,
                "max": 120,
                "default": 0,
                "unit": "km/h",
                "description": "Target cruise control speed set-point"
              }
            }
          }
        }
      }
    }
  }
}`,
    operations: [
      {
        kind: "OPEN",
        fd: 1,
        path: "Vehicle/ADAS/CruiseControl/SpeedSet?control,text,priority=10,lease=1000,as=IVI_EcoMode",
        pid: 4102,
        priority: 10,
        leaseMs: 1000,
        role: "IVI_EcoMode",
      },
      {
        kind: "OPEN",
        fd: 2,
        path: "Vehicle/ADAS/CruiseControl/.SpeedSet.control?priority=60,lease=1000,as=ADAS_AEB",
        pid: 1040,
        priority: 60,
        leaseMs: 1000,
        role: "ADAS_AEB",
      },
      {
        kind: "WRITE",
        fd: 1,
        value: 90,
        nowMs: 100,
      },
      {
        kind: "WRITE",
        fd: 2,
        value: 0,
        nowMs: 150,
      },
      {
        kind: "WRITE",
        fd: 1,
        value: 110,
        nowMs: 200,
      },
      {
        kind: "READ_WARDEN",
        path: "Vehicle/ADAS/CruiseControl/SpeedSet?warden,text",
        nowMs: 210,
      },
    ],
  },
  {
    id: "preset-3-crash-lease-rollback",
    title: "ADAS Holder Crash & Lease Rollback",
    description:
      "Verifies that when a high-priority holder (ADAS_AEB P60) crashes (io_close_ocb) or when a monotonic lease timer (CLOCK_MONOTONIC) expires, VssWarden automatically promotes the highest surviving standby request (ADAS_Cruise P45) or falls back to the VSS default safe value (0 km/h) so the actuator never deadlocks.",
    catalogJsonc: `${OFFICIAL_QPP_SIGNAL_CATALOG_HEADER}
{
  "Vehicle": {
    "type": "branch",
    "children": {
      "ADAS": {
        "type": "branch",
        "children": {
          "CruiseControl": {
            "type": "branch",
            "children": {
              "TargetSpeed": {
                "datatype": "int8",
                "type": "actuator",
                "min": 0,
                "max": 120,
                "default": 0,
                "unit": "km/h",
                "description": "Cruise control target speed with safe-state fallback"
              }
            }
          }
        }
      }
    }
  }
}`,
    operations: [
      {
        kind: "OPEN",
        fd: 1,
        path: "Vehicle/ADAS/CruiseControl/TargetSpeed",
        pid: 2050,
        priority: 45,
        leaseMs: 600,
        role: "ADAS_Cruise",
      },
      {
        kind: "OPEN",
        fd: 2,
        path: "Vehicle/ADAS/CruiseControl/TargetSpeed?control,text",
        pid: 1040,
        priority: 60,
        leaseMs: 500,
        role: "ADAS_AEB",
      },
      {
        kind: "OPEN",
        fd: 3,
        path: "Vehicle.ADAS.CruiseControl.TargetSpeed",
        pid: 4102,
        priority: 15,
        leaseMs: 500,
        role: "IVI_Cabin",
      },
      {
        kind: "WRITE",
        fd: 1,
        value: 80,
        nowMs: 100,
      },
      {
        kind: "WRITE",
        fd: 2,
        value: 20,
        nowMs: 150,
      },
      {
        kind: "CLOSE",
        fd: 2,
        reason: "CRASH_DISCONNECT",
        nowMs: 250,
      },
      {
        kind: "ADVANCE_CLOCK",
        deltaMs: 500,
      },
      {
        kind: "WRITE",
        fd: 3,
        value: 55,
        nowMs: 800,
      },
    ],
  },
];
