const metro_cities = [
  // Mumbai PIN codes
  "400001",
  "400002",
  "400003",
  "400004",
  "400005",
  "400006",
  "400007",
  "400008",
  "400009",
  "400010",
  "400011",
  "400012",
  "400013",
  "400014",
  "400015",
  "400016",
  "400017",
  "400018",
  "400019",
  "400020",
  "400021",
  "400022",
  "400024",
  "400025",
  "400026",
  "400027",
  "400028",
  "400031",
  "400034",
  "400035",
  // Delhi/New Delhi PIN codes
  "110001",
  "110002",
  "110003",
  "110005",
  "110010",
  "110016",
  "110018",
  "110021",
  "110024",
  "110033",
  "110034",
  "110036",
  "110045",
  "110049",
  "110051",
  "110052",
  "110055",
  "110058",
  "110062",
];

console.log(getZone("209602","110002"));


 function getZone(pickup, destination) {
  if (pickup.length !== 6 || destination.length !== 6) {
    return console.log("invalid pincode");
  }

  const inital = pickup.slice(0, 3);
  const des = destination.slice(0, 3);

  if (inital === des) {
      return "z_a"
  } else if(inital.slice(0,2) === des.slice(0,2)){
     return "z_b"
  }else {
    
    if (metro_cities.includes(pickup) && metro_cities.includes(destination)) {
      return "z_c"
    }else{
        return 'z_d'
    }
  
  }
}

module.exports = getZone;