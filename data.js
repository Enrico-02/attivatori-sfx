/* Activators in carousel order, and the parts whose motion makes a punctual event worth a sound, with an Italian
   label. Markers are found from the clip itself when it loads (same onset rule for Hover and Idle). */
window.ACTIVATORS = [
  { id: "robotica", sector: "Robotica", object: "Braccio robotico", fps: 24, single: true, exclude: /^IK/,
    note: "Nell'app il braccio ha una clip sola, la stessa in Idle e in Hover." },
  { id: "aerospazio", sector: "Aerospazio", object: "Satellite" },
  { id: "biotech", sector: "Biotech-Pharma", object: "Bioreattore" },
  { id: "macchinari", sector: "Macchinari avanzati", object: "Centro di lavoro CNC" },
  { id: "nautica", sector: "Nautica", object: "Nave" },
  { id: "energia", sector: "Energia rinnovabile", object: "Turbina eolica" },
  { id: "agrifood", sector: "Agrifood", object: "Trattore nel frutteto" },
  { id: "connettivita", sector: "Connettività", object: "Cavo in fibra ottica e globo" },
  { id: "industria40", sector: "Industria 4.0", object: "Linea di confezionamento e gemello digitale" },
  { id: "medicina", sector: "Medicina", object: "Protesi bionica" },
  { id: "microprocessori", sector: "Microprocessori", object: "Scheda elettronica" },
  { id: "chimici", sector: "Prodotti chimici", object: "Reattore" },
  { id: "rigenerazione", sector: "Rigenerazione urbana", object: "Bosco verticale" },
  { id: "sport", sector: "Industria dello sport", object: "Bici da corsa" },
];

// [part-name pattern, label, minimum gap between two markers of the same kind (s)]
window.EVENT_RULES = {
  aerospazio: [[/^Hinge/, "Pannelli solari", 0.5], [/^ThrusterPlume/, "Getto dei propulsori", 0.5],
               [/^SARBeam/, "Fascio radar", 1.0], [/^DownlinkWave/, "Onda verso terra", 0.5], [/^DataPacket/, "Pacchetto dati", 0.1]],
  biotech: [[/^DNARung/, "Elica del DNA", 1.0], [/^Cell/, "Cellule", 1.0], [/^ChartBar/, "Barre del grafico", 1.0],
            [/^Bubble/, "Bolle", 0.3], [/^StatusLed/, "LED di stato", 0.4]],
  macchinari: [[/^SpindleHead$/, "Testa del mandrino", 0.5], [/^Spark/, "Scintille del taglio", 3.0],
               [/^CoolantDrop/, "Gocce di refrigerante", 1.0], [/^WorkpieceLift$/, "Pezzo sollevato", 0.8],
               [/^QCScanRing$/, "Anello controllo qualità", 0.2]],
  nautica: [[/^RadarWave/, "Onda del radar", 0.25], [/^ExhaustPipe/, "Sbuffo dal fumaiolo", 0.6], [/^ScanRing/, "Anello di scansione", 0.5]],
  energia: [[/^ScanRing/, "Anello di scansione", 0.5], [/^GroundRing/, "Impulso a terra", 0.3], [/^PowerRing/, "Anello di energia", 0.3],
            [/^CablePulse/, "Impulso nel cavo", 0.3]],
  agrifood: [[/^GPSPulse/, "Impulso GPS", 0.5], [/^RowScanGate/, "Varco di scansione", 0.5], [/^SoilGrid/, "Griglia del terreno", 1.0],
             [/^Sprout_/, "Germogli", 0.5], [/^Blossom_/, "Fioritura", 0.5]],
  connettivita: [[/^ScanRing$/, "Anello di scansione", 0.8], [/^TipSpark/, "Scintilla in punta", 0.3], [/^ProjectionBeam/, "Fascio di luce", 2.0],
                 [/^SubseaArc_/, "Cavi sottomarini", 1.0], [/^GlobeNode_/, "Nodi delle città", 1.0]],
  industria40: [[/^Pusher$/, "Spintore", 0.5], [/^Product/, "Prodotto spinto", 0.5], [/^Carton/, "Cartone che si chiude", 0.5],
                [/^CoderFlash/, "Lampo del marcatore", 0.3], [/^ScanRing$/, "Anello di scansione", 0.5], [/^(DigitalTwin|Twin_)/, "Gemello digitale", 1.0]],
  medicina: [[/^EMGSensor/, "Sensore EMG", 0.5], [/^PalmPulse_/, "Impulso nel palmo", 0.5], [/^TipFlash_/, "Lampo sulle dita", 0.15],
             [/^ScanRing/, "Anello di scansione", 0.5]],
  microprocessori: [[/^Chip_Die$/, "Proiezione del chip", 1.5], [/^LED$/, "LED", 0.2], [/^LED_TX$/, "LED dati TX", 0.15], [/^LED_RX$/, "LED dati RX", 0.15]],
  chimici: [[/^Bubble/, "Bolle", 0.25], [/^ReactionFront/, "Fronte di reazione", 0.5], [/^FeedPulse/, "Carico", 0.5],
            [/^DischargePulse/, "Scarico", 0.5], [/^ScanRing/, "Anello di scansione", 0.5]],
  rigenerazione: [[/^GrowthScanner_/, "Scanner di crescita", 0.3], [/^Bloom_/, "Fioritura", 1.0], [/^WindowLights/, "Luci delle finestre", 0.3]],
  sport: [[/^ScanRing$/, "Anello di scansione", 0.5], [/^Seam_/, "Saldature del telaio", 0.5]],
};
// continuously spinning parts whose rhythm is audible: [pattern, events per turn, label]
window.SPIN_RULES = { energia: [[/^Rotor$/, 3, "Passa una pala"]], sport: [[/^Crankset$/, 2, "Pedalata"]] };

// robot arm: the moments of its single 10.417 s clip (peaks of each joint, from the clip data)
window.ROBOT_MARKERS = [
  [0.62, "Spalla si alza (primo grande movimento)"], [0.88, "Connettore e cavo"], [1.29, "Scatto del polso"],
  [3.08, "Secondo movimento: spalla e gomito"], [3.67, "Torcia"], [4.75, "Torcia"],
  [6.58, "Polso"], [7.25, "Gomito e cavo insieme"], [8.21, "Polso"], [9.29, "Rotazione veloce della base"],
  [10.33, "Fermo, poi riparte"],
];
