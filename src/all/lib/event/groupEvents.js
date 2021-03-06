/**
 * Group Listeners
 *
 * Used for handling groups / group edits
 *
 * @copyright (c) 2017-present Passbolt SARL
 * @licence GNU Affero General Public License http://www.gnu.org/licenses/agpl-3.0.en.html
 */

var Worker = require('../model/worker');
var User = require('../model/user').User;
var Group = require('../model/group').Group;
var GroupForm = require('../model/groupForm').GroupForm;
var TabStorage = require('../model/tabStorage').TabStorage;
var _ = require("../vendors/underscore-min");

var Keyring = require('../model/keyring').Keyring;
var Crypto = require('../model/crypto').Crypto;
var masterPasswordController = require('../controller/masterPasswordController');
const defer = require('sdk/core/promise').defer;

var listen = function (worker) {
    /*
     * Initialize the group edit process.
     *
     * If groupId is provided, will load the group info from the server and inform App, which will in turn inform the client.
     *
     * @listens passbolt.app.group-edit-init
     * @param groupId {uuid} The group id, null if creation
     */
    worker.port.on('passbolt.group.edit.init', function (requestId, data) {
        var groupId = data.groupId,
            groupForm = new GroupForm(worker.tab.id);

        if (groupId != '') {
            var group = new Group();
            group.findById(groupId)
                .then(
                    function success(group) {
                        groupForm.init('edit', group);
                        var appWorker = Worker.get('App', worker.tab.id);
                        appWorker.port.emit('passbolt.group.edit.group_loaded', group);
                    },
                    function error(errorResponse) {
                        // TO DO.
                    }
                );
        }
        else {
            groupForm.init('create');
        }

        worker.port.emit(requestId, 'SUCCESS');
    });

    /*
     * Search users that could be added to a group.
     * Once the search has been completed, send the users to the autocomplete
     * worker.
     *
     * @listens passbolt.group.search-users
     * @param keywords {string} The keywords to search
     */
    worker.port.on('passbolt.group.edit.search-users', function (keywords) {
        var //sharedPassword = TabStorage.get(worker.tab.id, 'sharedPassword'),
            user = new User(),
            autocompleteWorker = Worker.get('GroupEditAutocomplete', worker.tab.id),
            // The users that have already been added to the share list should be
            // excluded from the search.
            groupForm = new GroupForm(worker.tab.id),
            excludedUsers = [];

        // If no keywords provided, hide the autocomplete component.
        if (!keywords) {
            autocompleteWorker.port.emit('passbolt.group.edit-autocomplete.reset');
        }
        // Otherwise, search the users who match the keywords,
        // and display them in the autocomplete component.
        else {
            autocompleteWorker.port.emit('passbolt.group.edit-autocomplete.loading');

            // Get existing users.
            var groupUsers = groupForm.get('currentGroup.GroupUser');
            excludedUsers = _.pluck(groupUsers, 'user_id');

            // Search available users.
            user.searchUsers(keywords, excludedUsers)
                .then(function(users) {
                    autocompleteWorker.port.emit('passbolt.group.edit-autocomplete.load-users', users);
                }, function(e) {
                    console.error(e);
                });
        }
    });

    /**
     * Encrypt a list of secrets after a response from a dry-run call.
     * @param group
     *   the group response returned from a dry-run call.
     */
    var encryptSecrets = function (group) {
        var deferred = defer();

        // nothing to do, we can return immediately.
        if (group['dry-run'] == undefined || group['dry-run'] == 0 || group['dry-run']['SecretsNeeded'] == 0) {
            deferred.resolve([]);
            return deferred.promise;
        }

        var secretsToEncrypt = group['dry-run']['SecretsNeeded'],
            mySecrets = group['dry-run']['Secrets'];

        // Encrypt secrets.
        var keyring = new Keyring(),
            crypto = new Crypto(),
            progressWorker = Worker.get('Progress', worker.tab.id),
            progress = 0,
            progressItemsCount = secretsToEncrypt.length * 2;

        // Master password required to decrypt secrets before re-encrypting them.
        masterPasswordController.get(worker).then(function (masterPassword) {
        // Once the master password retrieved, decrypt the secret.

            // Open the progress dialog.
            worker.port.emit('passbolt.progress.open-dialog', 'Encrypting ...', progressItemsCount);
            var promises = [];

            mySecrets.forEach(function(mySecret, i) {
                var p = crypto.decrypt(mySecrets[i].Secret[0].data, masterPassword);
                promises.push(p);
                // Update the progress dialog.
                p.then(function (data) {
                    mySecrets[i].Secret[0].dataClear = data;
                    progress++;
                    if (progressWorker != null) {
                        progressWorker.port.emit('passbolt.progress.update', 'Decrypted ' + mySecrets[i].Resource.name, progress);
                    }
                });
            });
            return Promise.all(promises);
        })
        .then(function(data) {
            // Sync the keyring with the server.
            keyring.sync().then(function () {
                // Once the keyring is synced, encrypt the secret for each user.

                // Store the encryption promise for each user in this array.
                // Encryptions will be treated in parallel to optimize the treatment.
                var promises = [];

                secretsToEncrypt.forEach(function (secretToEncrypt, index) {
                    // Retrieve password.
                    var userId = secretToEncrypt['Secret'].user_id;
                    // Search password in clear.
                    var passwordClear = '';
                    mySecrets.forEach(function(mySecret, index1) {
                        if(secretToEncrypt['Secret'].resource_id == mySecrets[index1]['Secret'][0].resource_id) {
                            passwordClear = mySecrets[index1]['Secret'][0].dataClear;
                        }
                    });

                    var p = crypto.encrypt(passwordClear, userId);
                    promises.push(p);

                    // Update the progress dialog.
                    p.then(function (encryptedData) {
                        // Add the encrypted part to the secret.
                        secretsToEncrypt[index]['Secret'].data = encryptedData;

                        // Update progress bar.
                        progress++;
                        if (progressWorker != null) {
                            progressWorker.port.emit('passbolt.progress.update', 'Encrypted for ' + userId, progress);
                        }
                    });
                });

                return Promise.all(promises);
            })

            // Once the secret is encrypted for all users notify the application and
            // close the progress dialog.
            .then(function (data) {
                deferred.resolve(secretsToEncrypt);
                worker.port.emit('passbolt.progress.close-dialog');
            });
        });

        return deferred.promise;
    };

    /*
     * Saves / update a group.
     * Receives the instruction from the app that the group is ready to be saved.
     * The plugin already knows the list of groupUsers, which is stored in
     * the local storage by the groupForm model.
     *
     * @listens passbolt.group.edit.save
     * @param group {object}
     *   a group object, with name only.
     */
    worker.port.on('passbolt.group.edit.save', function (requestId, groupToSave) {
        // Get groupForm object.
        var groupForm = new GroupForm(worker.tab.id),
            currentGroup = groupForm.get().currentGroup;

        // Set group name.
        groupForm.set('currentGroup.Group.name', groupToSave.name);

        // Get Json for save.
        var groupJson = groupForm.getPostJson(),
            group = new Group(),
            groupUserChangeList = groupForm.getGroupUsersChangeList(),
            isGroupUserCreated = _.where(groupUserChangeList, {status: "created"}).length > 0 ? true : false, // Check if a groupUser is created in the operation.
            isEdit = currentGroup.Group.id != undefined && currentGroup.Group.id != ''; // Check if it's an edit operation, or a create one.


        // In case of existing group, update it.
        if (isEdit) {
            // If no groupUser has been created, make a direct call to save. We do not need a dry-run, so we save one call.
            if (!isGroupUserCreated) {
                group.save(groupJson, currentGroup.Group.id).then(
                    function(groupSaved) {
                        worker.port.emit(requestId, 'SUCCESS', groupSaved);
                    },
                    function error(error) {
                        worker.port.emit(requestId, 'ERROR', error);
                    });
            }
            // Else, if a groupUser has been created, we need to call dry-run first.
            else {
                // Save group in dry-run.
                // The result of this operation will provide us with the list of passwords to encrypt and provide
                // for the actual save.
                group.save(groupJson, currentGroup.Group.id, true)
                    .then(
                        function success(groupDryRun) {
                            // Encrypt secrets for all users.
                            encryptSecrets(groupDryRun).then(function(secrets) {
                                groupJson['Secrets'] = secrets;
                                group.save(groupJson, currentGroup.Group.id).then(
                                    function(groupSaved) {
                                        worker.port.emit(requestId, 'SUCCESS', groupSaved);
                                    },
                                    function error(error) {
                                        worker.port.emit(requestId, 'ERROR', error);
                                    });
                            });
                        },
                        function error(errorResponse) {
                            worker.port.emit(requestId, 'ERROR', errorResponse);
                        }
                    );
            }
        }
        // Create case.
        else {
            group.save(groupJson)
                .then(
                    function success(group) {
                        worker.port.emit(requestId, 'SUCCESS', group);
                    },
                    function error(errorResponse) {
                        worker.port.emit(requestId, 'ERROR', errorResponse);
                    }
                );
        }
    });

    /*
     * A groupUser has been temporary deleted.
     * Remove it from the list of group users, it added
     * previously.
     *
     * @listens passbolt.group.edit.remove-group_user
     * @param groupUser {string} The groupUser that has been removed.
     */
    worker.port.on('passbolt.group.edit.remove-group_user', function (requestId, groupUser) {
        var groupForm = new GroupForm(worker.tab.id);
        groupForm.deleteGroupUser(groupUser).then(
            function(groupUser) {
                worker.port.emit(requestId, 'SUCCESS', groupUser);
            },
            function(error) {
                worker.port.emit(requestId, 'ERROR', error);
            }
        );
    });

    /*
     * A groupUser has been temporary deleted.
     * Remove it from the list of group users, it added
     * previously.
     *
     * @listens passbolt.group.edit.remove-group_user
     * @param groupUser {string} The groupUser that has been removed.
     */
    worker.port.on('passbolt.group.edit.edit-group_user', function (requestId, groupUser) {
        var groupForm = new GroupForm(worker.tab.id),
            appWorker = Worker.get('App', worker.tab.id);

        groupForm.updateGroupUser(groupUser).then(
            function(groupUser) {
                worker.port.emit(requestId, 'SUCCESS', groupUser);
            },
            function(error) {
                worker.port.emit(requestId, 'ERROR', error);
            }
        );
    });

    /*
     * A groupUser has been modified in the groupUsers list.
     *
     * @listens passbolt.group.edit.get_group_users_change_list
     */
    worker.port.on('passbolt.group.edit.get_group_users_change_list', function (requestId) {
        var groupForm = new GroupForm(worker.tab.id),
            changeList = groupForm.getGroupUsersChangeList();
        worker.port.emit(requestId, 'SUCCESS', changeList);
    });
};
exports.listen = listen;