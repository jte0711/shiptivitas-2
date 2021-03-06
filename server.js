import express from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';

const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  return res.status(200).send({'message': 'SHIPTIVITY API. Read documentation to see API docs'});
});

// We are keeping one connection alive for the rest of the life application for simplicity
const db = new Database('./clients.db');

// Don't forget to close connection when server gets terminated
const closeDb = () => db.close();
process.on('SIGTERM', closeDb);
process.on('SIGINT', closeDb);

/**
 * Validate id input
 * @param {any} id
 */
const validateId = (id) => {
  if (Number.isNaN(id)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Id can only be integer.',
      },
    };
  }
  const client = db.prepare('select * from clients where id = ? limit 1').get(id);
  if (!client) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Cannot find client with that id.',
      },
    };
  }
  return {
    valid: true,
  };
}

/**
 * Validate priority input
 * @param {any} priority
 */
const validatePriority = (priority) => {
  if (Number.isNaN(priority)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid priority provided.',
      'long_message': 'Priority can only be positive integer.',
      },
    };
  }
  return {
    valid: true,
  }
}

/**
 * Get all of the clients. Optional filter 'status'
 * GET /api/v1/clients?status={status} - list all clients, optional parameter status: 'backlog' | 'in-progress' | 'complete'
 */
app.get('/api/v1/clients', (req, res) => {
  const status = req.query.status;
  if (status) {
    // status can only be either 'backlog' | 'in-progress' | 'complete'
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        'message': 'Invalid status provided.',
        'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }
    const clients = db.prepare('select * from clients where status = ?').all(status);
    return res.status(200).send(clients);
  }
  const statement = db.prepare('select * from clients');
  const clients = statement.all();
  return res.status(200).send(clients);
});

/**
 * Get a client based on the id provided.
 * GET /api/v1/clients/{client_id} - get client by id
 */
app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }
  return res.status(200).send(db.prepare('select * from clients where id = ?').get(id));
});

/**
 * Update client information based on the parameters provided.
 * When status is provided, the client status will be changed
 * When priority is provided, the client priority will be changed with the rest of the clients accordingly
 * Note that priority = 1 means it has the highest priority (should be on top of the swimlane).
 * No client on the same status should not have the same priority.
 * This API should return list of clients on success
 *
 * PUT /api/v1/clients/{client_id} - change the status of a client
 *    Data:
 *      status (optional): 'backlog' | 'in-progress' | 'complete',
 *      priority (optional): integer,
 *
 */

const updateNewLane = (client, clientsArr) =>{
  let newLane = clientsArr.filter(cl => cl.status == client.status && cl.priority >= client.priority && cl.id !== client.id);
  let newClientsArr = clientsArr.filter (cl => cl.status !== client.status || cl.priority < client.priority || cl.id === client.id);
  const statement1 = db.prepare("UPDATE clients SET priority = (@priority), status = (@status) WHERE id=(@id);");
  const statement2 = db.prepare("UPDATE clients SET priority = (@priority) WHERE id=(@id);");

  //check if priorities no more than status array length and adjust it
  newLane.forEach((el) =>{
    el.priority += 1
    statement2.run({
      priority: el.priority,
      id: el.id
    });
  });

  if (newLane.length === 0){
    client.priority = clientsArr.filter(cl => cl.status == client.status && cl.id !== client.id).length+1;
  }

  statement1.run({
    priority: client.priority,
    status: client.status,
    id: client.id
  });

  newClientsArr = newClientsArr.concat(newLane).concat(client);

  return newClientsArr;
};

const updatePrevLane = (client, clientsArr) => {

  //remove the prevClient from array
    // find it's index
    // splice it (delete)
  //update the priority 

  let newArr = clientsArr.filter(cl => cl.status !== client.status || cl.priority < client.priority);
  let prevLane = clientsArr.filter(cl => cl.status === client.status && cl.id !== client.id && cl.priority > client.priority);
  const statement = db.prepare("UPDATE clients SET priority = (@priority) WHERE id=(@id);");

  prevLane.forEach( (el) =>{
    el.priority -= 1;
    statement.run({
      priority: el.priority,
      id: el.id
    });
  });

  newArr = newArr.concat(prevLane);

  return newArr;  
}

app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);  //get id
  const { valid, messageObj } = validateId(id); //check validness
  if (!valid) {
    res.status(400).send(messageObj);
  }

  let { status, priority } = req.body;  //get status and priority, put this as the new status and priority
  let clients = db.prepare('select * from clients').all();
  const client = clients.find(client => client.id === id); //client which we will update

  /* ---------- Update code below ----------*/

  let result = updatePrevLane(client, clients);

  //update the client with new status and priority
  client.status = status;
  client.priority = priority;

  result = updateNewLane(client, result);

  result.sort((a,b)=>{
    return a.id - b.id;
  });

  // get the list of clients with target status and list of client with previous status
  // find priority which has the same number as client, change it +1 and to the priority following it (use filter)
  // find priority which has +1 of the previous priority then -1 it's and the following clients
  // add new client to the array
  // send back the full clients result

  // ----- UPDATE DATABASE ------
  // 1. in updatePrevLane, loop through and use prepare to (update one client at a time)
  // 2. in updateNewLane, loop through and use prepare to (update one client at a time)

  return res.status(200).send(result);
});

app.put('/api/v1/clients', (req, res) => {
  const renew = fs.readFileSync('clients.sql', 'utf8');
  db.exec(renew);
  return res.status(200).send("Database Renewed");
});

app.listen(3001);
console.log('app running on port ', 3001);
